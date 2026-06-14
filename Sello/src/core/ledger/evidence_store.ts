/**
 * evidence_store.ts — content-addressed store for raw subject output.
 *
 * CONTRACT §2: the raw output does NOT go inline in the verdict. It is stored
 * here; the verdict carries only `result.evidence_hash`. This avoids ledger
 * bloat and data leakage, and lets `verify` detect tampering: if the stored
 * bytes no longer hash to evidence_hash → INTEGRITY_FAIL.
 */

import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './canonical.ts';

export class EvidenceStore {
  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  /** Store raw output, return its hash as "sha256:<hex>". */
  put(raw: string): string {
    const hex = sha256(Buffer.from(raw, 'utf-8'));
    const file = path.join(this.dir, `${hex}.txt`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, raw, 'utf-8');
    return `sha256:${hex}`;
  }

  /** Read raw output back by "sha256:<hex>" handle; null if missing. */
  get(evidenceHash: string): string | null {
    const hex = evidenceHash.replace(/^sha256:/, '');
    const file = path.join(this.dir, `${hex}.txt`);
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file, 'utf-8');
  }

  /**
   * Re-derive the hash of the stored bytes and compare to the claimed handle.
   * Returns false if the file is missing or its content was tampered with.
   */
  verify(evidenceHash: string): boolean {
    const raw = this.get(evidenceHash);
    if (raw === null) return false;
    const hex = evidenceHash.replace(/^sha256:/, '');
    return sha256(Buffer.from(raw, 'utf-8')) === hex;
  }
}
