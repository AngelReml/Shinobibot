/**
 * integrity/csv_verify.ts — self-contained verification of a Sello Certified
 * Skill Verdict (CSV), for the runtime integrity layer (Capa 2, check 11.1).
 *
 * This is the consumer side of Sello's CSV (CONTRACT §11): it re-derives the
 * certificate's this_hash with the SAME canonicalization Sello uses (sorted keys,
 * 2-space indent, LF), checks the ed25519 signature against the pubkey EMBEDDED in
 * the certificate, and reads the verdict. No private key, no network, no trust in
 * ZapWeave — exactly the "third party verifies offline" property. Crypto is Node
 * built-in; the algorithm is duplicated (not imported) so the agent runtime does
 * not depend on the Sello package.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';

/** Recursively sort object keys (matches Sello core/ledger/canonical.ts). */
function sortKeysDeep(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortKeysDeep);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj as Record<string, unknown>).sort()) {
    out[k] = sortKeysDeep((obj as Record<string, unknown>)[k]);
  }
  return out;
}

function canonicalBytes(record: unknown): Buffer {
  const json = JSON.stringify(sortKeysDeep(record), null, 2).replace(/\r\n/g, '\n');
  return Buffer.from(json, 'utf-8');
}

function sha256Hex(data: Buffer | string): string {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf-8');
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Ported canonical hash (hex), byte-identical to Sello core/ledger/canonical.ts
 * `canonicalHash`. Exported so a drift-guard test can pin this copy to Sello's
 * output — if the two canonicalizations diverge, that test breaks.
 */
export function canonicalHashPorted(record: unknown): string {
  return sha256Hex(canonicalBytes(record));
}

function ed25519Verify(message: string, sigHex: string, pubPem: string): boolean {
  try {
    const key = crypto.createPublicKey(pubPem);
    return crypto.verify(null, Buffer.from(message, 'utf-8'), key, Buffer.from(sigHex, 'hex'));
  } catch {
    return false;
  }
}

export interface SkillCSVLike {
  csv_version?: string;
  subject?: { skill_id?: string; skill_artifact_hash?: string; contract_hash?: string };
  verdict?: 'CERTIFIED' | 'NOT_CERTIFIED';
  integrity?: { this_hash?: string; verifier_pubkey?: string; signature?: { alg?: string; sig_hex?: string } };
  [k: string]: unknown;
}

export interface CsvVerifyResult {
  ok: boolean;
  this_hash_ok: boolean;
  signature_ok: boolean;
  certified: boolean;
  verdict: string | null;
  skill_artifact_hash: string | null;
  reasons: string[];
}

/** sha256 over the raw bytes of a file → "sha256:<hex>". */
export function hashArtifactFile(filePath: string): string {
  return `sha256:${sha256Hex(fs.readFileSync(filePath))}`;
}

/**
 * Verify a CSV self-contained: this_hash recomputation + ed25519 signature
 * against the embedded pubkey, and read the verdict. Does NOT check the chain or
 * evidence (the runtime only needs: is this certificate authentic + CERTIFIED).
 */
export function verifyCsvCertificate(csv: SkillCSVLike): CsvVerifyResult {
  const reasons: string[] = [];
  const integrity = csv.integrity ?? {};

  // Recompute this_hash over everything except integrity.this_hash + signature.
  const hashable = JSON.parse(JSON.stringify(csv)) as SkillCSVLike;
  if (hashable.integrity) { delete hashable.integrity.this_hash; delete hashable.integrity.signature; }
  const recomputed = `sha256:${sha256Hex(canonicalBytes(hashable))}`;
  const this_hash_ok = integrity.this_hash === recomputed;
  if (!this_hash_ok) reasons.push(`this_hash mismatch: stored ${integrity.this_hash}, recomputed ${recomputed}`);

  let signature_ok = false;
  if (!integrity.signature?.sig_hex || !integrity.verifier_pubkey) {
    reasons.push('missing signature or verifier_pubkey');
  } else {
    signature_ok = ed25519Verify(integrity.this_hash ?? '', integrity.signature.sig_hex, integrity.verifier_pubkey);
    if (!signature_ok) reasons.push('ed25519 signature does not verify against embedded verifier_pubkey');
  }

  const certified = csv.verdict === 'CERTIFIED';
  if (!certified) reasons.push(`certificate verdict is ${csv.verdict ?? 'absent'} (not CERTIFIED)`);

  return {
    ok: this_hash_ok && signature_ok && certified,
    this_hash_ok,
    signature_ok,
    certified,
    verdict: csv.verdict ?? null,
    skill_artifact_hash: csv.subject?.skill_artifact_hash ?? null,
    reasons,
  };
}
