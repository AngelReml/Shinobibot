#!/usr/bin/env -S npx tsx
/**
 * cli/sello.ts — Sello command-line entry.
 *
 *   sello run <task_id> <subject-command...>   emit a signed PoBI verdict
 *   sello verify <verdict-file>                check signature + chain + evidence
 *   sello replay <task_id>                     re-run the last subject for task_id
 *
 * Sello is a pure verifier: `run` invokes a SUBJECT (via the cli-process
 * adapter), grades its output, and emits a signed, hash-chained verdict. It is
 * NOT an agent and takes no autonomous action.
 */

import fs from 'node:fs';
import { runTask } from '../harness/runner.ts';
import { type PoBIVerdict, verifyVerdict, HARNESS_VERSION } from '../core/verdict/pobi.ts';
import { EvidenceStore } from '../core/ledger/evidence_store.ts';
import { verifyLedger, lastEntryForTask, type LedgerEntry } from '../core/ledger/recorder.ts';
import { canonicalHash } from '../core/ledger/canonical.ts';
import { PATHS } from '../core/paths.ts';

function usage(): never {
  console.error(`sello — pure behavioral verifier (PoBI)

usage:
  sello run <task_id> <subject-command...>   run a subject and emit a signed verdict
  sello verify <verdict-file>                verify signature + chain + evidence
  sello replay <task_id>                     re-run the last subject for task_id
`);
  process.exit(2);
}

function recomputeEnvHash(command: string): string {
  return `sha256:${canonicalHash({
    harness_version: HARNESS_VERSION,
    adapter: 'cli-process',
    subject_command: command,
    mode: 'clean',
    system_prompt: null,
  })}`;
}

async function cmdRun(args: string[]): Promise<number> {
  const [taskId, ...cmdParts] = args;
  if (!taskId || cmdParts.length === 0) usage();
  const command = cmdParts.join(' ');
  const { verdict } = await runTask(taskId, command);
  // Raw verdict to stdout (this IS the emitted artifact).
  process.stdout.write(JSON.stringify(verdict, null, 2) + '\n');
  return verdict.result.verdict === 'PASS' ? 0 : 1;
}

function cmdVerify(args: string[]): number {
  const file = args[0];
  if (!file) usage();
  if (!fs.existsSync(file)) { console.error(`verify: file not found: ${file}`); return 2; }
  const verdict = JSON.parse(fs.readFileSync(file, 'utf-8')) as PoBIVerdict;
  const reasons: string[] = [];

  // 1) this_hash recomputation + ed25519 signature.
  const vr = verifyVerdict(verdict);
  reasons.push(...vr.reasons);

  // 2) evidence integrity (INTEGRITY_FAIL on mismatch — CONTRACT §3).
  const evidence = new EvidenceStore(PATHS.evidenceDir);
  const evidenceOk = evidence.verify(verdict.result.evidence_hash);
  if (!evidenceOk) reasons.push(`INTEGRITY_FAIL: evidence ${verdict.result.evidence_hash} missing or tampered`);

  // 3) env_hash integrity (CN-19 false-override detection — CONTRACT §2).
  const envOk = recomputeEnvHash(verdict.subject.agent_id) === verdict.conditions.env_hash;
  if (!envOk) reasons.push('INTEGRITY_FAIL: env_hash does not match recomputed harness environment');

  // 4) chain membership: this_hash present in ledger + global chain intact.
  const chain = verifyLedger(PATHS.ledger);
  let chainMember = false;
  if (!chain.ok) {
    reasons.push(`chain broken: ${chain.reason}`);
  } else if (fs.existsSync(PATHS.ledger)) {
    const lines = fs.readFileSync(PATHS.ledger, 'utf-8').trimEnd().split('\n').filter(Boolean);
    chainMember = lines.map((l) => JSON.parse(l) as LedgerEntry).some((e) => e.this_hash === verdict.integrity.this_hash);
    if (!chainMember) reasons.push('this_hash not found in ledger (verdict not chained)');
  }

  const ok = vr.ok && evidenceOk && envOk && chain.ok && chainMember;
  const out = {
    file,
    task_id: verdict.task.task_id,
    verdict: verdict.result.verdict,
    this_hash_ok: vr.this_hash_ok,
    signature_ok: vr.signature_ok,
    evidence_ok: evidenceOk,
    env_hash_ok: envOk,
    chain_ok: chain.ok && chainMember,
    integrity_status: ok ? 'OK' : (evidenceOk && envOk ? 'TAMPERED' : 'INTEGRITY_FAIL'),
    reasons,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  return ok ? 0 : 1;
}

async function cmdReplay(args: string[]): Promise<number> {
  const taskId = args[0];
  if (!taskId) usage();
  const manifestPath = `${PATHS.runsDir}/${taskId}.last.json`;
  if (!fs.existsSync(manifestPath)) {
    console.error(`replay: no prior run for ${taskId} (manifest ${manifestPath} missing). Run it first.`);
    return 2;
  }
  const prev = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { command: string; this_hash: string };
  const prevEntry = lastEntryForTask(PATHS.ledger, taskId);
  const { verdict } = await runTask(taskId, prev.command);
  const sameVerdict = !!prevEntry && prevEntry.verdict === verdict.result.verdict;
  const out = {
    task_id: taskId,
    command: prev.command,
    previous_verdict: prevEntry?.verdict ?? null,
    replay_verdict: verdict.result.verdict,
    deterministic: sameVerdict,
    new_this_hash: verdict.integrity.this_hash,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  return sameVerdict ? 0 : 1;
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'run': return cmdRun(rest);
    case 'verify': return cmdVerify(rest);
    case 'replay': return cmdReplay(rest);
    default: usage();
  }
}

main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
