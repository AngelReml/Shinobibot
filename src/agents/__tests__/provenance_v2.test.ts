// src/agents/__tests__/provenance_v2.test.ts
//
// Tests del motor E7 (provenance v2: Ed25519 + cadena). Determinista, sin red.
// Prueba la propiedad clave: verificable por cualquiera con la pública, pero
// imposible de falsificar sin la privada; y cualquier edición del rastro se caza.

import { describe, it, expect, beforeAll } from 'vitest';
import {
  generateProvenanceKeypair, buildSignedProvenance, verifySignedProvenance,
  type SignedProvenance,
} from '../provenance_v2.js';

const AUDIT =
  '{"kind":"tool_call","tool":"read_file","success":true,"durationMs":2}\n' +
  '{"kind":"tool_call","tool":"write_file","success":true,"durationMs":5}\n' +
  '{"kind":"loop_abort","tool":"x","verdict":"LOOP_DETECTED"}';

let kp: { publicKeyPem: string; privateKeyPem: string };
let pkg: SignedProvenance;

beforeAll(() => {
  kp = generateProvenanceKeypair();
  pkg = buildSignedProvenance({
    taskId: 't1', prompt: 'haz algo', finalText: 'hecho',
    auditText: AUDIT, verdict: { passed: true, rationale: 'ok' },
    privateKeyPem: kp.privateKeyPem, publicKeyPem: kp.publicKeyPem,
    now: () => '2026-06-10T00:00:00.000Z',
  });
});

describe('provenance v2 — firma Ed25519 + audit hash-chain', () => {
  it('emite un paquete con pública embebida, firma y raíz del audit', () => {
    expect(pkg.version).toBe(2);
    expect(pkg.alg).toBe('ed25519');
    expect(pkg.publicKeyPem).toContain('PUBLIC KEY');
    expect(pkg.signature).toMatch(/^[0-9a-f]+$/);
    expect(pkg.auditChainRoot).toMatch(/^[0-9a-f]{64}$/);
  });

  it('un paquete legítimo es válido (verificable por cualquiera, sin secreto compartido)', () => {
    expect(verifySignedProvenance(pkg)).toEqual({ valid: true, reason: 'ok' });
  });

  it('manipular el resultado → hash_mismatch', () => {
    expect(verifySignedProvenance({ ...pkg, finalText: 'mentira' }).reason).toBe('hash_mismatch');
  });

  it('manipular el RASTRO de audit embebido → audit_root_mismatch', () => {
    const tampered = { ...pkg, auditLog: pkg.auditLog!.replace('read_file', 'evil_tool') };
    expect(verifySignedProvenance(tampered).reason).toBe('audit_root_mismatch');
  });

  it('sustituir la pública por otra → signature_mismatch (forja inviable)', () => {
    const other = generateProvenanceKeypair();
    expect(verifySignedProvenance({ ...pkg, publicKeyPem: other.publicKeyPem }).reason).toBe('signature_mismatch');
  });

  it('una firma de otra clave sobre la pública original → signature_mismatch', () => {
    // Reconstruir con otra privada pero declarando la pública original = no valida.
    const other = generateProvenanceKeypair();
    const impostor = buildSignedProvenance({
      taskId: pkg.taskId, prompt: pkg.prompt, finalText: pkg.finalText,
      auditText: AUDIT, verdict: pkg.verdict,
      privateKeyPem: other.privateKeyPem, publicKeyPem: kp.publicKeyPem, // miente sobre la pública
      now: () => '2026-06-10T00:00:00.000Z',
    });
    expect(verifySignedProvenance(impostor).reason).toBe('signature_mismatch');
  });

  it('es determinista: misma entrada → misma firma', () => {
    const again = buildSignedProvenance({
      taskId: 't1', prompt: 'haz algo', finalText: 'hecho',
      auditText: AUDIT, verdict: { passed: true, rationale: 'ok' },
      privateKeyPem: kp.privateKeyPem, publicKeyPem: kp.publicKeyPem,
      now: () => '2026-06-10T00:00:00.000Z',
    });
    expect(again.signature).toBe(pkg.signature);
    expect(again.contentHash).toBe(pkg.contentHash);
  });
});
