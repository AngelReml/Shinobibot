/**
 * skill/runner.ts — FASE A skill certification pipeline (CONTRACT §10/§11).
 *
 * certifySkill(): load manifest (+ verify artifact identity) → load the skill's
 * bank → run each case's INPUT through the skill subject (cli-process adapter,
 * scenario JSON on stdin) → store raw output in the evidence-store → grade with
 * json_schema against the case's computed oracle → aggregate into a profile →
 * assemble, sign and hash-chain a CSV → append to ledger/skills.jsonl → persist
 * the CSV + a replay manifest.
 *
 * It reuses the F0 crypto/ledger/evidence/grader machinery verbatim; the only new
 * thing is the SUBJECT (a bounded skill) and the AGGREGATE artifact (the CSV).
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadBank, type BankTask } from '../harness/bank.ts';
import { runCliProcess } from '../harness/adapters/cli_process.ts';
import { getGrader } from '../graders/index.ts';
import type { Grader, Verdict } from '../graders/types.ts';
import { EvidenceStore } from '../core/ledger/evidence_store.ts';
import { appendBuilt, type LedgerEntry } from '../core/ledger/recorder.ts';
import { canonicalHash } from '../core/ledger/canonical.ts';
import { loadOrCreateKeypair } from '../core/ledger/keys.ts';
import { HARNESS_VERSION } from '../core/verdict/pobi.ts';
import { PATHS, ADAPTER_TIMEOUT_MS } from '../core/paths.ts';
import { loadManifest, type LoadedSkill } from './manifest.ts';
import {
  CSV_VERSION, type SkillCSV, type SkillCase,
  csvEnvHash, aggregateVerdict, signCSV,
} from './csv.ts';

export interface CertifyResult {
  csv: SkillCSV;
  ledgerEntry: LedgerEntry;
  csvPath: string;
}

/** Grade one skill case: json_schema(output) vs the case's oracle_output. */
function gradeCase(task: BankTask, output: string): Verdict {
  const shim = {
    id: task.task_id,
    grader: { kind: task.grader, config: task.grader_config } as unknown as Grader,
    // The skill's value-oracle is the case's oracle_output (CONTRACT §11).
    ground_truth: { expected: (task.oracle_output ?? {}) as Record<string, unknown> },
  };
  try {
    return getGrader(task.grader).grade(output, shim).verdict;
  } catch {
    return 'ERROR';
  }
}

export async function certifySkill(skillDir: string, artifactOverride?: string): Promise<CertifyResult> {
  const skill: LoadedSkill = loadManifest(skillDir, artifactOverride);
  const bank = loadBank(skill.bankPath);
  if (bank.length === 0) throw new Error(`skill bank is empty: ${skill.bankPath}`);

  const evidence = new EvidenceStore(PATHS.evidenceDir);
  const kp = loadOrCreateKeypair(PATHS.keysDir);
  const command = `node ${skill.artifactPath}`;

  // ── Run every case through the skill subject, in CLEAN mode ────────────────
  const cases: SkillCase[] = [];
  for (const task of bank) {
    const scenario = (task.input as any).scenario ?? task.input;
    const adapterRes = await runCliProcess({
      command,
      taskId: task.task_id,
      prompt: JSON.stringify(scenario),
      timeoutMs: ADAPTER_TIMEOUT_MS,
    });
    const evidenceHash = evidence.put(adapterRes.stdout);
    const verdict: Verdict = adapterRes.timed_out ? 'TIMEOUT' : gradeCase(task, adapterRes.stdout);
    cases.push({
      case_id: task.task_id,
      task_hash: `sha256:${canonicalHash(task)}`,
      grader_id: task.grader,
      verdict,
      evidence_hash: evidenceHash,
    });
  }

  const agg = aggregateVerdict(cases);
  const tsIso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const bankRaw = fs.readFileSync(skill.bankPath, 'utf-8');

  const csv: SkillCSV = {
    csv_version: CSV_VERSION,
    subject: {
      skill_id: skill.manifest.skill_id,
      version: skill.manifest.version,
      author: skill.manifest.author,
      contract_hash: skill.contractHash,
      skill_artifact_hash: skill.artifactHash,
    },
    declared: { tools: skill.manifest.declared_tools, effects: skill.manifest.declared_effects },
    conditions: { mode: 'clean', probes: [] },
    bank: { bank_hash: `sha256:${canonicalHash(bankRaw)}`, case_count: cases.length },
    cases,
    profile: {
      correctness_clean: { pass: agg.pass, total: agg.total, pass_rate: agg.pass_rate },
      robustness: null,
    },
    verdict: agg.verdict,
    execution: { ts: tsIso, harness_version: HARNESS_VERSION, env_hash: csvEnvHash() },
    provenance: {
      manifest_ref: path.relative(process.cwd(), path.join(skill.dir, 'manifest.json')),
      bank_ref: path.relative(process.cwd(), skill.bankPath),
    },
    integrity: { prev_hash: 'genesis', verifier_pubkey: kp.publicKeyPem },
  };

  // Read head + sign (this_hash binds prev_hash) + append, under one lock.
  const ledgerEntry = appendBuilt(PATHS.skillLedger, (prev) => {
    csv.integrity.prev_hash = prev;
    signCSV(csv, kp.privateKeyPem);
    return {
      task_id: csv.subject.skill_id,
      verdict: csv.verdict,
      this_hash: csv.integrity.this_hash!,
      prev_hash: prev,
      recorded_utc: tsIso,
    };
  });

  // Persist the CSV + a replay manifest.
  fs.mkdirSync(PATHS.runsDir, { recursive: true });
  const shortHash = csv.integrity.this_hash!.replace(/^sha256:/, '').slice(0, 16);
  const csvPath = path.join(PATHS.runsDir, `${csv.subject.skill_id}__${shortHash}.csv.json`);
  fs.writeFileSync(csvPath, JSON.stringify(csv, null, 2), 'utf-8');
  fs.writeFileSync(
    path.join(PATHS.runsDir, `${csv.subject.skill_id}.csv.last.json`),
    JSON.stringify({ skill_id: csv.subject.skill_id, skillDir, artifactOverride: artifactOverride ?? null, this_hash: csv.integrity.this_hash, csvPath }, null, 2),
    'utf-8',
  );

  return { csv, ledgerEntry, csvPath };
}
