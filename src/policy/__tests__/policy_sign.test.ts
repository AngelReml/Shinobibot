// P4 — tests de la firma de policy. Mutación: verifyPolicySignature siempre true →
// las alteraciones de policy/firma/clave pasan → rojo. Regla #2, evidencia en DECISIONES.
import { describe, it, expect } from 'vitest';
import { signPolicy, verifyPolicySignature } from '../policy_sign.js';
import { loadPolicy, DENY_ALL_POLICY } from '../engine.js';
import { generateKeyPairSync } from 'crypto';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function keys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { pub: publicKey.export({ type: 'spki', format: 'pem' }).toString(), priv: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
}
const policy = { default: ['shell:/ws'], profiles: { net: ['net:x'] }, ttlMs: 1000 };

describe('P4 — firma de policy', () => {
  it('sign → verify roundtrip; alteración ⇒ false', () => {
    const { pub, priv } = keys();
    const sig = signPolicy(policy, priv, pub);
    expect(verifyPolicySignature(policy, sig)).toBe(true);
    expect(verifyPolicySignature({ ...policy, default: ['shell:*'] }, sig)).toBe(false);
    expect(verifyPolicySignature(policy, { ...sig, publicKeyPem: keys().pub })).toBe(false);
  });

  it('loadPolicy con REQUIRE_SIGNATURE: firmada carga; sin firma o alterada ⇒ DENY_ALL', () => {
    const { pub, priv } = keys();
    const sig = signPolicy(policy, priv, pub);
    const dir = mkdtempSync(join(tmpdir(), 'polsig_'));
    const signed = join(dir, 'signed.json'); writeFileSync(signed, JSON.stringify({ ...policy, signature: sig }));
    const unsigned = join(dir, 'unsigned.json'); writeFileSync(unsigned, JSON.stringify(policy));
    const tampered = join(dir, 'tampered.json'); writeFileSync(tampered, JSON.stringify({ ...policy, default: ['shell:*'], signature: sig }));
    process.env.SHINOBI_POLICY_REQUIRE_SIGNATURE = '1';
    try {
      expect(loadPolicy(signed).default).toEqual(['shell:/ws']);
      expect(loadPolicy(unsigned)).toBe(DENY_ALL_POLICY);
      expect(loadPolicy(tampered)).toBe(DENY_ALL_POLICY);
    } finally {
      delete process.env.SHINOBI_POLICY_REQUIRE_SIGNATURE;
    }
  });

  it('sin REQUIRE_SIGNATURE: policy sin firma se carga (back-compat)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'polnos_'));
    const f = join(dir, 'p.json'); writeFileSync(f, JSON.stringify(policy));
    delete process.env.SHINOBI_POLICY_REQUIRE_SIGNATURE;
    expect(loadPolicy(f).default).toEqual(['shell:/ws']);
  });
});
