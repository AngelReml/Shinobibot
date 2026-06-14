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
import path from 'node:path';
import { runTask } from '../harness/runner.ts';
import { type PoBIVerdict, verifyVerdict, HARNESS_VERSION } from '../core/verdict/pobi.ts';
import { EvidenceStore } from '../core/ledger/evidence_store.ts';
import { verifyLedger, lastEntryForTask, type LedgerEntry } from '../core/ledger/recorder.ts';
import { canonicalHash } from '../core/ledger/canonical.ts';
import { PATHS } from '../core/paths.ts';
import { certifySkill } from '../skill/runner.ts';
import {
  type SkillCSV, verifyCSVSignature, csvEnvHash, aggregateClean, computeCsvVerdict,
} from '../skill/csv.ts';
import { loadManifest } from '../skill/manifest.ts';
import { loadBank } from '../harness/bank.ts';
import { loadProbes, runProbe, expectedShiftVerdict } from '../skill/probe_runner.ts';

function usage(): never {
  console.error(`sello — pure behavioral verifier (PoBI)

usage:
  sello run <task_id> <subject-command...>   run a subject and emit a signed verdict
  sello verify <verdict-file>                verify signature + chain + evidence
  sello replay <task_id>                     re-run the last subject for task_id

  sello skill-cert <skill-dir> [artifact]    certify a skill: run its bank clean,
                                             emit a signed CSV (CONTRACT §11).
                                             [artifact] overrides the subject file
                                             (e.g. skill_buggy.mjs) to prove the
                                             certificate discriminates.
  sello skill-verify <csv-file>              verify a CSV: signature + chain +
                                             evidence + env + profile recompute
  sello skill-replay <skill-dir> [artifact]  re-certify and check the verdict +
                                             profile are deterministic vs the last CSV
  sello skill-probe <skill-dir> <vuln>       FASE B: run the skill's probes against
                                             the robust (declared) artifact AND a
                                             vulnerable variant <vuln>; print the
                                             robust-holds vs vulnerable-falls table
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

// ── Skill certification (CONTRACT §10/§11) ──────────────────────────────────

async function cmdSkillCert(args: string[]): Promise<number> {
  const [dir, artifact] = args;
  if (!dir) usage();
  const { csv } = await certifySkill(dir, artifact);
  process.stdout.write(JSON.stringify(csv, null, 2) + '\n');
  return csv.verdict === 'CERTIFIED' ? 0 : 1;
}

function cmdSkillVerify(args: string[]): number {
  const file = args[0];
  if (!file) usage();
  if (!fs.existsSync(file)) { console.error(`skill-verify: file not found: ${file}`); return 2; }
  const csv = JSON.parse(fs.readFileSync(file, 'utf-8')) as SkillCSV;
  const reasons: string[] = [];

  // 1) this_hash recomputation + ed25519 signature.
  const sig = verifyCSVSignature(csv);
  reasons.push(...sig.reasons);

  // 2) evidence integrity for EVERY case (INTEGRITY_FAIL on mismatch — CONTRACT §11).
  const evidence = new EvidenceStore(PATHS.evidenceDir);
  let evidenceOk = true;
  for (const c of csv.cases) {
    if (!evidence.verify(c.evidence_hash)) {
      evidenceOk = false;
      reasons.push(`INTEGRITY_FAIL: evidence ${c.evidence_hash} (case ${c.case_id}) missing or tampered`);
    }
  }

  // 3) env_hash integrity.
  const envOk = csvEnvHash() === csv.execution.env_hash;
  if (!envOk) reasons.push('INTEGRITY_FAIL: env_hash does not match recomputed certification environment');

  // 4) chain membership: this_hash present in the skill ledger + chain intact.
  const chain = verifyLedger(PATHS.skillLedger);
  let chainMember = false;
  if (!chain.ok) {
    reasons.push(`chain broken: ${chain.reason}`);
  } else if (fs.existsSync(PATHS.skillLedger)) {
    const lines = fs.readFileSync(PATHS.skillLedger, 'utf-8').trimEnd().split('\n').filter(Boolean);
    chainMember = lines.map((l) => JSON.parse(l) as LedgerEntry).some((e) => e.this_hash === csv.integrity.this_hash);
    if (!chainMember) reasons.push('this_hash not found in skill ledger (CSV not chained)');
  }

  // 5) profile recompute from cases (+ robustness gate) must match stored profile + verdict.
  const clean = aggregateClean(csv.cases);
  const p = csv.profile.correctness_clean;
  const recomputedVerdict = computeCsvVerdict(clean, csv.profile.robustness);
  const profileOk = clean.pass === p.pass && clean.total === p.total && clean.pass_rate === p.pass_rate && recomputedVerdict === csv.verdict;
  if (!profileOk) {
    reasons.push(`profile mismatch: recomputed {pass:${clean.pass}, total:${clean.total}, verdict:${recomputedVerdict}} vs stored {pass:${p.pass}, total:${p.total}, verdict:${csv.verdict}}`);
  }

  const ok = sig.ok && evidenceOk && envOk && chain.ok && chainMember && profileOk;
  const out = {
    file,
    skill_id: csv.subject.skill_id,
    skill_artifact_hash: csv.subject.skill_artifact_hash,
    csv_verdict: csv.verdict,
    this_hash_ok: sig.this_hash_ok,
    signature_ok: sig.signature_ok,
    evidence_ok: evidenceOk,
    env_hash_ok: envOk,
    chain_ok: chain.ok && chainMember,
    profile_ok: profileOk,
    integrity_status: ok ? 'OK' : (evidenceOk && envOk ? 'TAMPERED' : 'INTEGRITY_FAIL'),
    reasons,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  return ok ? 0 : 1;
}

async function cmdSkillReplay(args: string[]): Promise<number> {
  const [dir, artifact] = args;
  if (!dir) usage();
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8')) as { skill_id: string };
  const lastPath = path.join(PATHS.runsDir, `${manifest.skill_id}.csv.last.json`);
  let prevVerdict: string | null = null;
  let prevProfile: { pass: number; total: number; pass_rate: number } | null = null;
  if (fs.existsSync(lastPath)) {
    const last = JSON.parse(fs.readFileSync(lastPath, 'utf-8')) as { csvPath?: string };
    if (last.csvPath && fs.existsSync(last.csvPath)) {
      const prev = JSON.parse(fs.readFileSync(last.csvPath, 'utf-8')) as SkillCSV;
      prevVerdict = prev.verdict;
      prevProfile = prev.profile.correctness_clean;
    }
  }
  const { csv } = await certifySkill(dir, artifact);
  const np = csv.profile.correctness_clean;
  const sameVerdict = prevVerdict === csv.verdict;
  const sameProfile = !!prevProfile && prevProfile.pass === np.pass && prevProfile.total === np.total && prevProfile.pass_rate === np.pass_rate;
  const out = {
    skill_id: manifest.skill_id,
    previous_verdict: prevVerdict,
    replay_verdict: csv.verdict,
    previous_profile: prevProfile,
    replay_profile: np,
    deterministic: sameVerdict && sameProfile,
    note: 'this_hash differs by design (ts + prev_hash advance); determinism is over verdict + profile',
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  return sameVerdict && sameProfile ? 0 : 1;
}

async function cmdSkillProbe(args: string[]): Promise<number> {
  const [dir, vuln] = args;
  if (!dir || !vuln) usage();
  const robust = loadManifest(dir);                 // declared (robust) artifact
  const vulnerable = loadManifest(dir, vuln);        // variant under test
  const bank = loadBank(robust.bankPath);
  const probes = loadProbes(dir);
  if (probes.length === 0) { console.error(`skill-probe: no probes.jsonl in ${dir}`); return 2; }
  const evidence = new EvidenceStore(PATHS.evidenceDir);
  const robustCmd = `node ${robust.artifactPath}`;
  const vulnCmd = `node ${vulnerable.artifactPath}`;

  const rows: any[] = [];
  let aDiscriminate = 0, aTotal = 0, bDetected = 0, bTotal = 0;
  for (const probe of probes) {
    const expected = expectedShiftVerdict(probe.expected_shift);
    const rRun = await runProbe(bank, probe, robustCmd, evidence);
    const vRun = await runProbe(bank, probe, vulnCmd, evidence);
    if (probe.plane === 'A') {
      aTotal++;
      const robustHolds = rRun.verdict === 'PASS';
      const vulnFalls = vRun.verdict === expected;
      const discriminates = robustHolds && vulnFalls;
      if (discriminates) aDiscriminate++;
      rows.push({ id: probe.id, class: probe.class, plane: 'A', op: probe.mutation.op, target: probe.target_case, robust: rRun.verdict, vulnerable: vRun.verdict, expected, robust_holds: robustHolds, vulnerable_falls: vulnFalls, discriminates });
    } else {
      bTotal++;
      const detected = rRun.verdict === expected;       // envelope is subject-agnostic
      if (detected) bDetected++;
      rows.push({ id: probe.id, class: probe.class, plane: 'B', op: probe.mutation.op, target: probe.target_case, robust: rRun.verdict, vulnerable: vRun.verdict, expected, detected });
    }
  }

  const out = {
    skill_id: robust.manifest.skill_id,
    robust_artifact: robust.artifactHash,
    vulnerable_artifact: vulnerable.artifactHash,
    plane_a: { discriminate: aDiscriminate, total: aTotal },
    plane_b: { detected: bDetected, total: bTotal },
    rows,
    gate_b_ok: aDiscriminate === aTotal && bDetected === bTotal,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  return out.gate_b_ok ? 0 : 1;
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'run': return cmdRun(rest);
    case 'verify': return cmdVerify(rest);
    case 'replay': return cmdReplay(rest);
    case 'skill-cert': return cmdSkillCert(rest);
    case 'skill-verify': return cmdSkillVerify(rest);
    case 'skill-replay': return cmdSkillReplay(rest);
    case 'skill-probe': return cmdSkillProbe(rest);
    default: usage();
  }
}

main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
