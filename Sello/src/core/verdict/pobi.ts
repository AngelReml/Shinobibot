/**
 * core/verdict/pobi.ts — PoBI verdict schema + deterministic canonicalization,
 * signing and verification (CONTRACT §2 / §3).
 *
 * The verdict is the unit of PoBI ("Proof of Behavioral Integrity"): a signed,
 * hash-chained record that a subject was put under stated CONDITIONS and a
 * grader returned a VERDICT over evidence the verdict only references by hash.
 *
 * Integrity rules (CONTRACT §2):
 *   this_hash  = "sha256:" + canonicalHash(verdict WITHOUT integrity.this_hash
 *                and integrity.signature)
 *   signature  = ed25519 over the this_hash string
 *   prev_hash  = previous verdict's this_hash (chain link)
 */

import { canonicalHash } from '../ledger/canonical.ts';
import { sign, verify } from '../ledger/keys.ts';
import type { Verdict } from '../../graders/types.ts';

export const POBI_VERSION = '0.2';
export const HARNESS_VERSION = '0.1.0';

export interface PoBIVerdict {
  pobi_version: string;
  subject: {
    agent_id: string;
    agent_artifact_hash: string;
    model: string;
    config_hash: string;
  };
  task: {
    task_id: string;
    task_hash: string;
    category: string;
    grader: string;
    is_adversarial: boolean;
  };
  conditions: {
    mode: 'clean' | 'perturbed';
    probes: string[];
    env_hash: string;
  };
  execution: {
    ts: string;
    harness_version: string;
    adapter: string;
    invocation_digest: string;
    runtime_ms: number;
  };
  result: {
    verdict: Verdict;
    grader_id: string;
    evidence_hash: string;
    score: number | null;
  };
  provenance: {
    task_source: string;
    agent_source: string;
  };
  integrity: {
    prev_hash: string;
    this_hash?: string;
    verifier_pubkey: string;
    signature?: { alg: 'ed25519'; sig_hex: string };
  };
}

/** Deep clone (structuredClone is available in Node 18+). */
function clone<T>(x: T): T {
  return structuredClone(x);
}

/** The record over which this_hash is computed: everything EXCEPT
 *  integrity.this_hash and integrity.signature (CONTRACT §2). */
export function hashableView(v: PoBIVerdict): PoBIVerdict {
  const c = clone(v);
  delete c.integrity.this_hash;
  delete c.integrity.signature;
  return c;
}

export function computeThisHash(v: PoBIVerdict): string {
  return `sha256:${canonicalHash(hashableView(v))}`;
}

/** Fill integrity.this_hash and integrity.signature in place. Mutates + returns. */
export function signVerdict(v: PoBIVerdict, privateKeyPem: string): PoBIVerdict {
  v.integrity.this_hash = computeThisHash(v);
  v.integrity.signature = { alg: 'ed25519', sig_hex: sign(v.integrity.this_hash, privateKeyPem) };
  return v;
}

export interface VerifyResult {
  ok: boolean;
  this_hash_ok: boolean;
  signature_ok: boolean;
  reasons: string[];
}

/** Verify a verdict's this_hash recomputation + ed25519 signature (self-contained
 *  against the embedded verifier_pubkey). Does NOT check evidence/chain — that is
 *  the caller's job (see cli verify). */
export function verifyVerdict(v: PoBIVerdict): VerifyResult {
  const reasons: string[] = [];
  const recomputed = computeThisHash(v);
  const this_hash_ok = v.integrity.this_hash === recomputed;
  if (!this_hash_ok) {
    reasons.push(`this_hash mismatch: stored ${v.integrity.this_hash}, recomputed ${recomputed}`);
  }
  let signature_ok = false;
  if (!v.integrity.signature) {
    reasons.push('missing signature');
  } else {
    signature_ok = verify(
      v.integrity.this_hash ?? '',
      v.integrity.signature.sig_hex,
      v.integrity.verifier_pubkey,
    );
    if (!signature_ok) reasons.push('ed25519 signature does not verify against verifier_pubkey');
  }
  return { ok: this_hash_ok && signature_ok, this_hash_ok, signature_ok, reasons };
}
