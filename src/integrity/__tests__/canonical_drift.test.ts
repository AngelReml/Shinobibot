import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalHashPorted, verifyCsvCertificate } from '../csv_verify.js';

/**
 * DRIFT GUARD (deuda C1). The integrity layer ships a PORTED copy of Sello's
 * canonical-hash (so the agent runtime doesn't depend on the Sello package). If
 * that copy ever drifts from Sello's real canonicalization, certificates would
 * verify here but not there (or vice versa) — silent, dangerous. These vectors
 * were produced by Sello's REAL core/ledger/canonical.ts `canonicalHash`
 * (regenerate via Sello if its canonical ever changes). If the ported impl
 * diverges, this test BREAKS.
 */
const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const vectors = JSON.parse(fs.readFileSync(path.join(FIX, 'canonical_vectors.json'), 'utf-8')) as Array<{ input: unknown; sello_sha256: string }>;
const csv = JSON.parse(fs.readFileSync(path.join(FIX, 'certified.csv.json'), 'utf-8'));

describe('drift guard — ported canonical == Sello canonical', () => {
  it('reproduces Sello canonicalHash byte-for-byte on every vector', () => {
    expect(vectors.length).toBeGreaterThan(0);
    for (const v of vectors) {
      expect(canonicalHashPorted(v.input)).toBe(v.sello_sha256);
    }
  });

  it('recomputes the this_hash Sello actually signed into a real CSV', () => {
    // Sello computed integrity.this_hash with ITS canonical; if the ported
    // canonical diverged, this_hash_ok would be false on a genuine certificate.
    const r = verifyCsvCertificate(csv);
    expect(r.this_hash_ok).toBe(true);
    expect(r.signature_ok).toBe(true);
  });
});
