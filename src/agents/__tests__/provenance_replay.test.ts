/**
 * Tests F4.1 — REPLAY CON DIVERGENCIA
 *
 * Verifica que replayProvenance() localiza exactamente la línea N adulterada,
 * no solo dice "inválido". Es la pieza que hace la verificabilidad visceral.
 */

import { describe, it, expect } from 'vitest';
import { replayProvenance, summarizeReplay } from '../provenance_replay.js';
import { buildSignedProvenance, generateProvenanceKeypair, verifySignedProvenance } from '../provenance_v2.js';

// ── fixtures ──────────────────────────────────────────────────────────────────

const AUDIT_5_LINES =
  '{"kind":"tool_call","tool":"read_file","success":true,"durationMs":3}\n' +
  '{"kind":"tool_call","tool":"list_dir","success":true,"durationMs":2}\n' +
  '{"kind":"tool_call","tool":"write_file","success":true,"durationMs":8}\n' +
  '{"kind":"tool_call","tool":"run_command","success":true,"durationMs":15}\n' +
  '{"kind":"agent_done","verdict":"COMPLETED","durationMs":120}';

function makePkg(audit = AUDIT_5_LINES) {
  const kp = generateProvenanceKeypair();
  return {
    pkg: buildSignedProvenance({
      taskId: 'replay-test', prompt: 'tarea de prueba', finalText: 'hecho',
      auditText: audit, embedAudit: true,
      privateKeyPem: kp.privateKeyPem, publicKeyPem: kp.publicKeyPem,
    }),
    kp,
  };
}

// ── casos base ────────────────────────────────────────────────────────────────

describe('replayProvenance — casos base', () => {
  it('audit sin modificar → ok, totalLines correcto', () => {
    const { pkg } = makePkg();
    const r = replayProvenance(pkg, AUDIT_5_LINES);
    expect(r.valid).toBe(true);
    expect(r.reason).toBe('ok');
    expect(r.totalLines).toBe(5);
    expect(r.divergeAtLine).toBeUndefined();
  });

  it('sin audit embebido → no_audit_embedded', () => {
    const { pkg } = makePkg();
    const pkgNoAudit = { ...pkg, auditLog: undefined };
    const r = replayProvenance(pkgNoAudit, AUDIT_5_LINES);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('no_audit_embedded');
  });

  it('audit vacío → ok con totalLines=0', () => {
    const { pkg } = makePkg('');
    const r = replayProvenance(pkg, '');
    expect(r.valid).toBe(true);
    expect(r.totalLines).toBe(0);
  });
});

// ── localización exacta de línea ──────────────────────────────────────────────

describe('replayProvenance — localización exacta de línea adulterada', () => {
  it('adultera línea 0 → divergeAtLine=0 con las líneas correctas', () => {
    const { pkg } = makePkg();
    const lines = AUDIT_5_LINES.split('\n');
    lines[0] = '{"kind":"tool_call","tool":"evil_tool","success":true}';
    const r = replayProvenance(pkg, lines.join('\n'));
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('tampered_line');
    expect(r.divergeAtLine).toBe(0);
    expect(r.tamperedLine).toContain('evil_tool');
    expect(r.originalLine).toContain('read_file');
  });

  it('adultera línea 2 → divergeAtLine=2 (no 0, no 1)', () => {
    const { pkg } = makePkg();
    const lines = AUDIT_5_LINES.split('\n');
    lines[2] = '{"kind":"tool_call","tool":"rm_all","success":true}';
    const r = replayProvenance(pkg, lines.join('\n'));
    expect(r.valid).toBe(false);
    expect(r.divergeAtLine).toBe(2);
  });

  it('adultera SOLO la última línea → divergeAtLine=4', () => {
    const { pkg } = makePkg();
    const lines = AUDIT_5_LINES.split('\n');
    lines[4] = '{"kind":"agent_done","verdict":"FAILED"}';
    const r = replayProvenance(pkg, lines.join('\n'));
    expect(r.valid).toBe(false);
    expect(r.divergeAtLine).toBe(4);
  });

  it('DEMO VISCERAL: N=10 líneas, cada adulteración rompe exactamente en su índice', () => {
    const manyLines = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ kind: 'tool_call', tool: `tool_${i}`, success: true, durationMs: i }));
    const { pkg } = makePkg(manyLines.join('\n'));

    for (let n = 0; n < 10; n++) {
      const tampered = [...manyLines];
      tampered[n] = JSON.stringify({ kind: 'tool_call', tool: 'evil', success: false });
      const r = replayProvenance(pkg, tampered.join('\n'));
      expect(r.divergeAtLine).toBe(n); // exactamente N
    }
  });
});

// ── inserción y borrado ────────────────────────────────────────────────────────

describe('replayProvenance — inserción y borrado de líneas', () => {
  it('línea insertada al final → length_mismatch', () => {
    const { pkg } = makePkg();
    const extra = AUDIT_5_LINES + '\n{"kind":"tool_call","tool":"injected"}';
    const r = replayProvenance(pkg, extra);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('length_mismatch');
  });

  it('línea borrada → length_mismatch detectado', () => {
    const { pkg } = makePkg();
    const lines = AUDIT_5_LINES.split('\n').slice(0, 4).join('\n');
    const r = replayProvenance(pkg, lines);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('length_mismatch');
  });
});

// ── integración con verifySignedProvenance ────────────────────────────────────

describe('replayProvenance — coherencia con verifySignedProvenance', () => {
  it('cuando replay dice ok, verifySignedProvenance también dice valid', () => {
    const { pkg } = makePkg();
    expect(replayProvenance(pkg, AUDIT_5_LINES).valid).toBe(true);
    expect(verifySignedProvenance(pkg).valid).toBe(true);
  });

  it('cuando replay detecta tamper, verifySignedProvenance también falla', () => {
    const { pkg } = makePkg();
    const lines = AUDIT_5_LINES.split('\n');
    lines[1] = '{"kind":"tool_call","tool":"evil","success":true}';
    const tamperedAudit = lines.join('\n');
    // replay localiza la línea
    const r = replayProvenance(pkg, tamperedAudit);
    expect(r.valid).toBe(false);
    expect(r.divergeAtLine).toBe(1);
    // verify detecta el tamper también (audit_root_mismatch)
    const pkgTampered = { ...pkg, auditLog: tamperedAudit };
    expect(verifySignedProvenance(pkgTampered).valid).toBe(false);
    expect(verifySignedProvenance(pkgTampered).reason).toBe('audit_root_mismatch');
  });
});

// ── summarizeReplay ───────────────────────────────────────────────────────────

describe('summarizeReplay', () => {
  it('ok → menciona totalLines', () => {
    const { pkg } = makePkg();
    const s = summarizeReplay(replayProvenance(pkg, AUDIT_5_LINES));
    expect(s).toContain('5');
    expect(s).toContain('✅');
  });

  it('tampered_line → menciona el número de línea (1-based)', () => {
    const { pkg } = makePkg();
    const lines = AUDIT_5_LINES.split('\n');
    lines[3] = '{"kind":"evil"}';
    const r = replayProvenance(pkg, lines.join('\n'));
    const s = summarizeReplay(r);
    expect(s).toContain('❌');
    expect(s).toContain('4'); // línea 4 (1-based)
  });

  it('no_audit_embedded → mensaje de advertencia', () => {
    const { pkg } = makePkg();
    const s = summarizeReplay(replayProvenance({ ...pkg, auditLog: undefined }, AUDIT_5_LINES));
    expect(s).toContain('⚠️');
  });
});
