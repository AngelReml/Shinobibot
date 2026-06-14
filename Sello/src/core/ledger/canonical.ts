/**
 * canonical.ts — deterministic JSON + hashing primitives.
 *
 * PROVENANCE: ported verbatim (logic unchanged) from
 *   OpenGravity/attestation-layer/src/forensic/canonical.mjs
 * Adapted: .mjs → .ts types. Zero external deps (Node built-ins only).
 *
 * This is the heart of "verifiable": the same record always produces the same
 * bytes, hence the same hash.
 */

import crypto from 'node:crypto';

/** Recursively sort object keys so serialization is deterministic. */
export function sortKeysDeep(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortKeysDeep);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj as Record<string, unknown>).sort()) {
    out[k] = sortKeysDeep((obj as Record<string, unknown>)[k]);
  }
  return out;
}

/** Canonical JSON bytes: sorted keys, 2-space indent, LF endings, UTF-8. */
export function canonicalBytes(record: unknown): Buffer {
  const json = JSON.stringify(sortKeysDeep(record), null, 2).replace(/\r\n/g, '\n');
  return Buffer.from(json, 'utf-8');
}

export function sha256(data: Buffer | string): string {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf-8');
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** sha256 of the canonical form of an object. */
export function canonicalHash(record: unknown): string {
  return sha256(canonicalBytes(record));
}
