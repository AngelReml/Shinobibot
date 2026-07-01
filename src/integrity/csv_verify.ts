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

/**
 * Pinned trust root: the production Sello verifier key this repo ships
 * certified skills under (matches src/integrity/certified/fs.write.v1 and the
 * test fixtures). Without pinning, `integrity.verifier_pubkey` is read from
 * the certificate being verified — its own subject — so anyone could mint a
 * fresh ed25519 keypair, self-sign a CERTIFIED CSV, and pass `ok: true`.
 */
const DEFAULT_TRUSTED_VERIFIER_PUBKEY =
  '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA3YrmGij9AFrqUlg2PrbVpH0QpXiAD9wBxnYWMYrGyIY=\n-----END PUBLIC KEY-----';

const _extraTrustedPubkeys = new Set<string>();

/**
 * Pin an additional verifier public key as trusted, in-memory, this process
 * only (e.g. onboarding a fresh local Sello instance's key).
 */
export function addTrustedVerifierPubkey(pem: string): void {
  _extraTrustedPubkeys.add(pem.trim());
}

function trustedVerifierPubkeys(): Set<string> {
  const keys = new Set<string>([DEFAULT_TRUSTED_VERIFIER_PUBKEY, ..._extraTrustedPubkeys]);
  const env = process.env.SHINOBI_TRUSTED_VERIFIER_PUBKEYS;
  if (env) {
    for (const block of env.split(/\n{2,}/)) {
      const t = block.trim();
      if (t) keys.add(t);
    }
  }
  return keys;
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
  pubkey_trusted: boolean;
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

  // ALTA-16 (auditoría 2026-07-01): verificar contra `recomputed` (el hash REAL
  // del contenido actual), no contra `integrity.this_hash` (un valor almacenado
  // que un atacante podría dejar intacto mientras modifica el contenido). Antes,
  // modificar p.ej. `subject.skill_artifact_hash` dejando `this_hash`/`signature`
  // sin tocar producía `this_hash_ok:false` (correcto) pero `signature_ok:true`
  // (engañoso — la firma seguía siendo válida sobre el hash ALMACENADO, no sobre
  // el contenido real). Cualquier consumidor que mirase solo `signature_ok`
  // concluía erróneamente que el certificado era auténtico. Verificando contra
  // `recomputed`, `signature_ok` refleja el contenido TAL COMO ESTÁ AHORA.
  let signature_ok = false;
  if (!integrity.signature?.sig_hex || !integrity.verifier_pubkey) {
    reasons.push('missing signature or verifier_pubkey');
  } else {
    signature_ok = ed25519Verify(recomputed, integrity.signature.sig_hex, integrity.verifier_pubkey);
    if (!signature_ok) reasons.push('ed25519 signature does not verify against the recomputed content hash');
  }

  // The pubkey embedded in the certificate is the SUBJECT being checked, never the
  // AUTHORITY — it must also match a pinned, operator-trusted key, or any self-minted
  // keypair could sign its own CERTIFIED verdict and pass.
  const pubkey_trusted = !!integrity.verifier_pubkey && trustedVerifierPubkeys().has(integrity.verifier_pubkey.trim());
  if (!pubkey_trusted) reasons.push('verifier_pubkey is not in the pinned trust store (untrusted/self-signed certificate)');

  const certified = csv.verdict === 'CERTIFIED';
  if (!certified) reasons.push(`certificate verdict is ${csv.verdict ?? 'absent'} (not CERTIFIED)`);

  return {
    ok: this_hash_ok && signature_ok && pubkey_trusted && certified,
    this_hash_ok,
    signature_ok,
    pubkey_trusted,
    certified,
    verdict: csv.verdict ?? null,
    skill_artifact_hash: csv.subject?.skill_artifact_hash ?? null,
    reasons,
  };
}
