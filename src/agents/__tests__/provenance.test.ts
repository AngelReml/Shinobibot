// src/agents/__tests__/provenance.test.ts
import { describe, it, expect } from 'vitest';
import { buildProvenancePackage, verifyProvenancePackage } from '../provenance.js';

const tc = (tool: string, success: boolean) =>
  JSON.stringify({ kind: 'tool_call', ts: '2026-06-08T00:00:00.000Z', tool, argsHash: 'h', argsPreview: '{}', success, durationMs: 1 });
const auditText = [tc('read_file', true), tc('write_file', true), tc('run_command', false)].join('\n');

function pkg(secret = 'sec') {
  return buildProvenancePackage({
    taskId: 't1', prompt: 'haz X', finalText: 'hecho',
    auditText, verdict: { passed: true, rationale: 'ok' },
    secret, now: () => '2026-06-08T00:00:00.000Z',
  });
}

describe('provenance — paquete de autonomía demostrable', () => {
  it('construye el paquete con resumen de audit + hash + firma', () => {
    const p = pkg();
    expect(p.audit).toEqual({ events: 3, toolCalls: 3, successes: 2, failures: 1, loopAborts: 0 });
    expect(p.contentHash).toHaveLength(64);
    expect(p.signature).toHaveLength(64);
    expect(p.auditLog).toContain('read_file');
  });

  it('verifica un paquete íntegro', () => {
    const p = pkg('sec');
    expect(verifyProvenancePackage(p, 'sec')).toEqual({ valid: true, reason: 'ok' });
  });

  it('detecta manipulación del contenido (hash)', () => {
    const p = pkg('sec');
    p.finalText = 'MENTIRA: hice otra cosa';
    expect(verifyProvenancePackage(p, 'sec').reason).toBe('hash_mismatch');
  });

  it('detecta firma con secreto equivocado', () => {
    const p = pkg('sec');
    expect(verifyProvenancePackage(p, 'otro-secreto').reason).toBe('signature_mismatch');
  });

  it('detecta manipulación del resumen de audit', () => {
    const p = pkg('sec');
    p.audit.failures = 0; // ocultar el fallo
    expect(verifyProvenancePackage(p, 'sec').valid).toBe(false);
  });
});
