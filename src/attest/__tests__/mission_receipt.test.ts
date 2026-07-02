// P2.E5 — tests del Recibo de Misión. Mutación canónica: un verificador que NO
// comprueba el no-exceso (effectsWithinMandate) dejaría pasar un efecto permitido
// fuera del mandato → el test de la corona se pone rojo. Verificado por el protocolo
// de la regla #2 (evidencia en DECISIONES.md). Reutiliza la primitiva Ed25519.
import { describe, it, expect } from 'vitest';
import { buildMissionReceipt, verifyMissionReceipt } from '../mission_receipt.js';
import { generateKeyPairSync } from 'crypto';

function keys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    pub: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    priv: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}
function baseReceipt() {
  const { pub, priv } = keys();
  return {
    pub, priv,
    receipt: buildMissionReceipt({
      missionId: 'm1',
      mandate: { capabilities: ['shell:/ws', 'fs.read:/data'] },
      effects: [
        { kind: 'shell', scope: '/ws', decision: 'allow' },
        { kind: 'fs.read', scope: '/data/x', decision: 'allow' },
      ],
      models: ['claude-opus-4-8'],
      auditText: '',
      privateKeyPem: priv,
      publicKeyPem: pub,
    }),
  };
}

describe('P2.E5 — Recibo de Misión (Modo Cristal)', () => {
  it('build -> verify: recibo válido con solo la pública', () => {
    expect(verifyMissionReceipt(baseReceipt().receipt)).toEqual({ valid: true, reason: 'ok' });
  });
  it('CORONA: un efecto permitido FUERA del mandato ⇒ mandate_exceeded', () => {
    const { pub, priv } = keys();
    const r = buildMissionReceipt({
      missionId: 'm2', mandate: { capabilities: ['shell:/ws'] },
      effects: [{ kind: 'net', scope: 'evil.com', decision: 'allow' }],
      auditText: '', privateKeyPem: priv, publicKeyPem: pub,
    });
    const v = verifyMissionReceipt(r);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('mandate_exceeded');
    expect(v.offendingEffect?.kind).toBe('net');
  });
  it('efecto añadido tras firmar ⇒ hash_mismatch', () => {
    const { receipt } = baseReceipt();
    const tampered = { ...receipt, effects: [...receipt.effects, { kind: 'net', scope: 'evil', decision: 'allow' as const }] };
    expect(verifyMissionReceipt(tampered).reason).toBe('hash_mismatch');
  });
  it('pública ajena ⇒ signature_mismatch', () => {
    const { receipt } = baseReceipt();
    expect(verifyMissionReceipt({ ...receipt, publicKeyPem: keys().pub }).reason).toBe('signature_mismatch');
  });
  it('audit distinto al firmado ⇒ audit_root_mismatch', () => {
    const { receipt } = baseReceipt();
    expect(verifyMissionReceipt(receipt, 'otra linea de audit\n').reason).toBe('audit_root_mismatch');
  });
  it('misión legado (mandate null) ⇒ válido sin chequeo de exceso', () => {
    const { pub, priv } = keys();
    const r = buildMissionReceipt({ missionId: 'm3', mandate: null, effects: [{ kind: 'shell', scope: '/x', decision: 'allow' }], auditText: '', privateKeyPem: priv, publicKeyPem: pub });
    expect(verifyMissionReceipt(r).valid).toBe(true);
  });
});
