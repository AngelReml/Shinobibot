/**
 * skill/csv.ts — Certified Skill Verdict (CSV) schema + sign/verify (CONTRACT §11).
 *
 * The CSV extends the PoBI verdict (core/verdict/pobi.ts): same canonical +
 * ed25519 + hash-chain machinery, but the SUBJECT is a bounded skill and the
 * body is the AGGREGATE of the skill bank's gradings plus a profile (not a single
 * PASS/FAIL). FASE A emits clean-only certificates; robustness is null until
 * FASE B fills it.
 *
 *   this_hash = "sha256:" + canonicalHash(CSV without integrity.this_hash + signature)
 *   signature = ed25519 over this_hash
 *   prev_hash = previous CSV's this_hash (chained in ledger/skills.jsonl)
 */

import { canonicalHash } from '../core/ledger/canonical.ts';
import { sign, verify } from '../core/ledger/keys.ts';
import { HARNESS_VERSION } from '../core/verdict/pobi.ts';
import type { Verdict } from '../graders/types.ts';
import type { DeclaredEffects } from './manifest.ts';

export const CSV_VERSION = '0.1';

export interface SkillCase {
  case_id: string;
  task_hash: string;
  grader_id: string;
  verdict: Verdict;
  evidence_hash: string;
}

export interface SkillCSV {
  csv_version: string;
  subject: {
    skill_id: string;
    version: string;
    author: string;
    contract_hash: string;
    skill_artifact_hash: string;
  };
  declared: { tools: string[]; effects: DeclaredEffects };
  conditions: { mode: 'clean' | 'perturbed'; probes: string[] };
  bank: { bank_hash: string; case_count: number };
  cases: SkillCase[];
  profile: {
    correctness_clean: { pass: number; total: number; pass_rate: number };
    robustness: null | Record<string, unknown>;
  };
  verdict: 'CERTIFIED' | 'NOT_CERTIFIED';
  execution: { ts: string; harness_version: string; env_hash: string };
  provenance: { manifest_ref: string; bank_ref: string };
  integrity: {
    prev_hash: string;
    this_hash?: string;
    verifier_pubkey: string;
    signature?: { alg: 'ed25519'; sig_hex: string };
  };
}

/** env_hash covers the certification environment (CONTRACT §11): mismatch → INTEGRITY_FAIL. */
export function csvEnvHash(): string {
  return `sha256:${canonicalHash({
    harness_version: HARNESS_VERSION,
    adapter: 'cli-process',
    grader: 'json_schema',
    mode: 'clean',
  })}`;
}

/** Aggregate policy (FASE A): CERTIFIED iff every clean case PASSed. */
export function aggregateVerdict(cases: SkillCase[]): {
  verdict: 'CERTIFIED' | 'NOT_CERTIFIED';
  pass: number;
  total: number;
  pass_rate: number;
} {
  const total = cases.length;
  const pass = cases.filter((c) => c.verdict === 'PASS').length;
  const pass_rate = total === 0 ? 0 : pass / total;
  return { verdict: total > 0 && pass === total ? 'CERTIFIED' : 'NOT_CERTIFIED', pass, total, pass_rate };
}

function clone<T>(x: T): T { return structuredClone(x); }

/** The record over which this_hash is computed (everything except this_hash + signature). */
export function hashableView(c: SkillCSV): SkillCSV {
  const v = clone(c);
  delete v.integrity.this_hash;
  delete v.integrity.signature;
  return v;
}

export function computeThisHash(c: SkillCSV): string {
  return `sha256:${canonicalHash(hashableView(c))}`;
}

/** Fill integrity.this_hash + signature in place. */
export function signCSV(c: SkillCSV, privateKeyPem: string): SkillCSV {
  c.integrity.this_hash = computeThisHash(c);
  c.integrity.signature = { alg: 'ed25519', sig_hex: sign(c.integrity.this_hash, privateKeyPem) };
  return c;
}

export interface CsvVerifyResult {
  ok: boolean;
  this_hash_ok: boolean;
  signature_ok: boolean;
  reasons: string[];
}

/** Self-contained check: this_hash recomputation + ed25519 signature against the
 *  embedded verifier_pubkey. Evidence/env/chain/profile are the CLI's job. */
export function verifyCSVSignature(c: SkillCSV): CsvVerifyResult {
  const reasons: string[] = [];
  const recomputed = computeThisHash(c);
  const this_hash_ok = c.integrity.this_hash === recomputed;
  if (!this_hash_ok) {
    reasons.push(`this_hash mismatch: stored ${c.integrity.this_hash}, recomputed ${recomputed}`);
  }
  let signature_ok = false;
  if (!c.integrity.signature) {
    reasons.push('missing signature');
  } else {
    signature_ok = verify(c.integrity.this_hash ?? '', c.integrity.signature.sig_hex, c.integrity.verifier_pubkey);
    if (!signature_ok) reasons.push('ed25519 signature does not verify against verifier_pubkey');
  }
  return { ok: this_hash_ok && signature_ok, this_hash_ok, signature_ok, reasons };
}
