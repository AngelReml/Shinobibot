/**
 * harness/runner.ts — the F0 verification pipeline.
 *
 * run(): load task → invoke subject via cli-process → store raw output in the
 * evidence-store → grade with the task's grader → assemble, sign and chain a
 * PoBI verdict (CONTRACT §2) → append to ledger → persist verdict + run manifest.
 *
 * The harness owns the verdicts only the harness/ledger may emit (TIMEOUT,
 * ERROR, INTEGRITY_FAIL); the grader owns PASS/FAIL/FORMAT_FAIL/CONTENT_FAIL/
 * SAFETY_FAIL (CONTRACT §3).
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadBank, getTask, type BankTask } from './bank.ts';
import { runCliProcess } from './adapters/cli_process.ts';
import { getGrader } from '../graders/index.ts';
import type { Grader, Verdict } from '../graders/types.ts';
import { EvidenceStore } from '../core/ledger/evidence_store.ts';
import { appendBuilt, type LedgerEntry } from '../core/ledger/recorder.ts';
import { canonicalHash } from '../core/ledger/canonical.ts';
import { loadOrCreateKeypair } from '../core/ledger/keys.ts';
import {
  type PoBIVerdict, signVerdict, POBI_VERSION, HARNESS_VERSION,
} from '../core/verdict/pobi.ts';
import { PATHS, ADAPTER_TIMEOUT_MS } from '../core/paths.ts';

const TASK_SOURCE = 'opengravity/legacy/src/banco/tasks/pilot_agentic_v1_bvp.ts';

function envHash(command: string): string {
  // CONTRACT §2: env_hash covers harness config + system-prompt. cli-process F0
  // has no system prompt; the harness config is the adapter + subject command.
  return `sha256:${canonicalHash({
    harness_version: HARNESS_VERSION,
    adapter: 'cli-process',
    subject_command: command,
    mode: 'clean',
    system_prompt: null,
  })}`;
}

export interface RunResult {
  verdict: PoBIVerdict;
  ledgerEntry: LedgerEntry;
  verdictPath: string;
}

export function runTask(taskId: string, command: string): Promise<RunResult> {
  const bank = loadBank(PATHS.bank);
  const task = getTask(bank, taskId);
  return runTaskWith(task, command);
}

export async function runTaskWith(task: BankTask, command: string): Promise<RunResult> {
  const evidence = new EvidenceStore(PATHS.evidenceDir);
  const kp = loadOrCreateKeypair(PATHS.keysDir);

  const t0 = Date.now();
  const adapterRes = await runCliProcess({
    command, taskId: task.task_id, prompt: String((task.input as any).prompt ?? ''),
    timeoutMs: ADAPTER_TIMEOUT_MS,
  });
  const runtimeMs = Date.now() - t0;

  const evidenceHash = evidence.put(adapterRes.stdout);

  // ── Determine the verdict ────────────────────────────────────────────────
  let finalVerdict: Verdict;
  if (adapterRes.timed_out) {
    finalVerdict = 'TIMEOUT';
  } else {
    try {
      const shimTask = {
        id: task.task_id,
        grader: { kind: task.grader, config: task.grader_config } as unknown as Grader,
        ground_truth: { expected: {} },
      };
      finalVerdict = getGrader(task.grader).grade(adapterRes.stdout, shimTask).verdict;
    } catch (e: any) {
      finalVerdict = 'ERROR';
    }
  }

  // ── Assemble PoBI verdict (CONTRACT §2) ──────────────────────────────────
  const tsIso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const base: PoBIVerdict = {
    pobi_version: POBI_VERSION,
    subject: {
      agent_id: command,
      agent_artifact_hash: adapterRes.invocation_digest,
      model: 'cli-process',
      config_hash: `sha256:${canonicalHash({ command })}`,
    },
    task: {
      task_id: task.task_id,
      task_hash: `sha256:${canonicalHash(task)}`,
      category: task.category,
      grader: task.grader,
      is_adversarial: task.adversarial,
    },
    conditions: { mode: 'clean', probes: [], env_hash: envHash(command) },
    execution: {
      ts: tsIso,
      harness_version: HARNESS_VERSION,
      adapter: 'cli-process',
      invocation_digest: adapterRes.invocation_digest,
      runtime_ms: runtimeMs,
    },
    result: {
      verdict: finalVerdict,
      grader_id: task.grader,
      evidence_hash: evidenceHash,
      score: null,
    },
    provenance: { task_source: TASK_SOURCE, agent_source: command },
    integrity: { prev_hash: 'genesis', verifier_pubkey: kp.publicKeyPem },
  };

  // Read head + sign (this_hash binds prev_hash) + append, all under one lock.
  const ledgerEntry = appendBuilt(PATHS.ledger, (prev) => {
    base.integrity.prev_hash = prev;
    signVerdict(base, kp.privateKeyPem);
    return {
      task_id: base.task.task_id,
      verdict: base.result.verdict,
      this_hash: base.integrity.this_hash!,
      prev_hash: prev,
      recorded_utc: tsIso,
    };
  });

  // Persist the full signed verdict + a run manifest (for replay).
  fs.mkdirSync(PATHS.runsDir, { recursive: true });
  const shortHash = base.integrity.this_hash!.replace(/^sha256:/, '').slice(0, 16);
  const verdictPath = path.join(PATHS.runsDir, `${task.task_id}__${shortHash}.verdict.json`);
  fs.writeFileSync(verdictPath, JSON.stringify(base, null, 2), 'utf-8');
  fs.writeFileSync(
    path.join(PATHS.runsDir, `${task.task_id}.last.json`),
    JSON.stringify({ task_id: task.task_id, command, this_hash: base.integrity.this_hash, verdictPath }, null, 2),
    'utf-8',
  );

  return { verdict: base, ledgerEntry, verdictPath };
}
