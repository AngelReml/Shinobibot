// P1.E3.c (plan de frontera) — tests de la firma Ed25519 del mandato y la identidad
// de dispositivo. Mutación canónica: `verifyMandate` que siempre valida → las
// aserciones de manipulación (mandato/firma/clave) se ponen ROJAS. Verificado con el
// protocolo de la regla #2 (romper → rojo → restaurar → verde); evidencia en
// DECISIONES.md. La cripto reutiliza la primitiva Ed25519 de provenance_v2 (node:crypto).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { signMandate, verifyMandate, verifyMandateSignature, canonicalMandate } from '../mandate_sign.js';
import { verifyMissionStart, verifyMissionStartLine } from '../verify.js';
import { getDeviceIdentity, _resetDeviceIdentity } from '../device_identity.js';
import { dpapiUsable, dpapiSkipReason } from '../../__tests__/_platform_probe.js';
import { generateKeyPairSync } from 'crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

if (!dpapiUsable) console.warn(`[mandate_sign.test] SKIP tests DPAPI en reposo — ${dpapiSkipReason}`);

function keys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    pub: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    priv: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}
const m = { capabilities: ['shell:*', 'fs.read:/data'], expiresAt: 12345 };

describe('P1.E3.c — firma/verificación Ed25519 del mandato', () => {
  it('roundtrip: un mandato firmado verifica con su pública', () => {
    const { pub, priv } = keys();
    expect(verifyMandate(m, signMandate(m, priv, pub)).valid).toBe(true);
  });
  it('mandato manipulado ⇒ inválido (hash_mismatch)', () => {
    const { pub, priv } = keys();
    const sig = signMandate(m, priv, pub);
    const v = verifyMandate({ capabilities: ['shell:*', 'fs.write:/etc'], expiresAt: 12345 }, sig);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('hash_mismatch');
  });
  it('firma manipulada ⇒ inválido', () => {
    const { pub, priv } = keys();
    const sig = signMandate(m, priv, pub);
    // `signature` es hex: cambiar el primer nibble por OTRO valor (no fijo) —
    // `replace(/^./, '0')` era no-op ~1/16 de las veces (cuando ya empezaba por
    // '0'), y el test flakeaba en verde para una firma sin tocar.
    const tampered = sig.signature.replace(/^[0-9a-f]/, (c) => (c === '0' ? '1' : '0'));
    expect(tampered).not.toBe(sig.signature); // la manipulación SIEMPRE cambia algo
    expect(verifyMandate(m, { ...sig, signature: tampered }).valid).toBe(false);
  });
  it('pública ajena ⇒ inválido (no se puede falsificar sin la privada)', () => {
    const { pub, priv } = keys();
    const sig = signMandate(m, priv, pub);
    expect(verifyMandate(m, { ...sig, publicKeyPem: keys().pub }).valid).toBe(false);
  });
  it('canonicalMandate determinista (mismo mandato ⇒ mismo canónico)', () => {
    expect(canonicalMandate(m)).toBe(canonicalMandate({ capabilities: ['shell:*', 'fs.read:/data'], expiresAt: 12345 }));
  });
});

describe('P1.E3.c — identidad de dispositivo (load-or-create)', () => {
  // Este bloque prueba load-or-create, NO el cifrado en reposo: fuerza el
  // formato legado para no pagar (ni depender de) un powershell.exe/DPAPI en frío.
  beforeAll(() => { process.env.SHINOBI_DEVICE_KEY_NO_DPAPI = '1'; });
  afterAll(() => { delete process.env.SHINOBI_DEVICE_KEY_NO_DPAPI; });

  it('crea la primera vez y reusa después (misma pública)', () => {
    _resetDeviceIdentity();
    const p = join(mkdtempSync(join(tmpdir(), 'shinobi_dev_')), 'device_key.json');
    const a = getDeviceIdentity(p);
    _resetDeviceIdentity();
    const b = getDeviceIdentity(p);
    expect(b.publicKeyPem).toBe(a.publicKeyPem);
    expect(a.publicKeyPem).toContain('BEGIN PUBLIC KEY');
  });
});

describe(
  dpapiUsable
    ? 'P2.E3.c — identidad de dispositivo cifrada en reposo (DPAPI real)'
    : `P2.E3.c — identidad de dispositivo cifrada en reposo — SKIP: ${dpapiSkipReason}`,
  () => {
  const itDpapi = dpapiUsable ? it : it.skip;

  itDpapi('el JSON persistido usa formato DPAPI y NO contiene la privada en claro', () => {
    _resetDeviceIdentity();
    const p = join(mkdtempSync(join(tmpdir(), 'shinobi_dev_dpapi_')), 'device_key.json');
    const identity = getDeviceIdentity(p);

    const raw = JSON.parse(readFileSync(p, 'utf-8'));
    expect(raw.dpapi).toBe(true);
    expect(typeof raw.privateKeyEnc).toBe('string');
    expect(raw.privateKeyPem).toBeUndefined();

    const onDisk = readFileSync(p, 'utf-8');
    expect(onDisk).not.toContain('BEGIN PRIVATE KEY');
    expect(onDisk).not.toContain(identity.privateKeyPem);
  });

  itDpapi('un segundo arranque desenvuelve el blob DPAPI y reusa la MISMA identidad', () => {
    _resetDeviceIdentity();
    const p = join(mkdtempSync(join(tmpdir(), 'shinobi_dev_dpapi_')), 'device_key.json');
    const a = getDeviceIdentity(p);
    _resetDeviceIdentity();
    const b = getDeviceIdentity(p);
    expect(b.publicKeyPem).toBe(a.publicKeyPem);
    expect(b.privateKeyPem).toBe(a.privateKeyPem);
  });

  it('formato legado (privateKeyPem en claro, sin dpapi) se sigue leyendo sin migración forzosa', () => {
    _resetDeviceIdentity();
    const p = join(mkdtempSync(join(tmpdir(), 'shinobi_dev_legacy_')), 'device_key.json');
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const legacy = {
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
    writeFileSync(p, JSON.stringify(legacy), { encoding: 'utf-8', mode: 0o600 });

    const loaded = getDeviceIdentity(p);
    expect(loaded.publicKeyPem).toBe(legacy.publicKeyPem);
    expect(loaded.privateKeyPem).toBe(legacy.privateKeyPem);
  });

  itDpapi('blob DPAPI corrupto/ilegible ⇒ se regenera una identidad nueva (no lanza, no reutiliza clave dudosa)', () => {
    _resetDeviceIdentity();
    const p = join(mkdtempSync(join(tmpdir(), 'shinobi_dev_corrupt_')), 'device_key.json');
    const a = getDeviceIdentity(p);
    _resetDeviceIdentity();

    const raw = JSON.parse(readFileSync(p, 'utf-8'));
    raw.privateKeyEnc = Buffer.from('blob-dpapi-invalido').toString('base64');
    writeFileSync(p, JSON.stringify(raw), { encoding: 'utf-8', mode: 0o600 });

    const b = getDeviceIdentity(p);
    expect(b.publicKeyPem).not.toBe(a.publicKeyPem); // no reutiliza la clave dudosa: identidad nueva
    expect(b.publicKeyPem).toContain('BEGIN PUBLIC KEY');
  });
});


describe('P2 (Modo Cristal) — verificador standalone de mission_start', () => {
  function signedRecord() {
    const { pub, priv } = keys();
    const mm = { capabilities: ['shell:*'], expiresAt: 999 };
    const sig = signMandate(mm, priv, pub);
    return { kind: 'mission_start', capabilities: mm.capabilities, expiresAt: mm.expiresAt, signature: sig.signature, devicePublicKeyPem: pub };
  }
  it('un mission_start firmado verifica con solo la pública', () => {
    expect(verifyMissionStart(signedRecord())).toEqual({ valid: true, reason: 'ok' });
  });
  it('mandato manipulado en el evento ⇒ signature_mismatch', () => {
    const r = signedRecord();
    expect(verifyMissionStart({ ...r, capabilities: ['shell:*', 'net:evil'] }).reason).toBe('signature_mismatch');
  });
  it('evento sin firma ⇒ unsigned (la firma es best-effort en E3.c)', () => {
    const r = signedRecord();
    expect(verifyMissionStart({ ...r, signature: undefined }).reason).toBe('unsigned');
  });
  it('línea JSONL válida verifica; basura ⇒ malformed', () => {
    expect(verifyMissionStartLine(JSON.stringify(signedRecord())).valid).toBe(true);
    expect(verifyMissionStartLine('{no-json').reason).toBe('malformed');
  });
  it('verifyMandateSignature: firma ajena ⇒ false', () => {
    const { pub, priv } = keys();
    const mm = { capabilities: ['shell:*'] };
    const sig = signMandate(mm, priv, pub);
    expect(verifyMandateSignature(mm, sig.signature, keys().pub)).toBe(false);
  });
});
