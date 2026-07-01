// F2.3 (auditoría 2026-07) — anti-truncado: el hash-chain (CRIT-06) detecta
// manipulación de una línea existente, pero NO detecta que se hayan borrado
// líneas del FINAL del log (truncado) porque nunca hubo referencia externa a
// cuántas líneas debería haber. `audit_anchor.ts` añade esa referencia.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  appendAnchor,
  readAnchors,
  maybeAnchor,
  checkAnchorIntegrity,
  anchorPath,
} from '../audit_anchor.js';
import { buildChain, GENESIS } from '../audit_chain.js';

describe('audit_anchor — F2.3 anti-truncado', () => {
  let dir: string;
  let logPath: string;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shinobi-audit-anchor-'));
    logPath = join(dir, 'audit.jsonl');
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  function writeLines(lines: string[]): void {
    writeFileSync(logPath, lines.map((l) => l + '\n').join(''), 'utf-8');
  }

  it('appendAnchor + readAnchors: persiste y relee registros en orden', () => {
    appendAnchor(logPath, { lineCount: 5, chainHash: 'abc', ts: '2026-01-01T00:00:00.000Z' });
    appendAnchor(logPath, { lineCount: 10, chainHash: 'def', ts: '2026-01-01T00:01:00.000Z' });
    const anchors = readAnchors(logPath);
    expect(anchors).toHaveLength(2);
    expect(anchors[0].lineCount).toBe(5);
    expect(anchors[1].lineCount).toBe(10);
    expect(existsSync(anchorPath(logPath))).toBe(true);
  });

  it('anchorPath vive en fichero DISTINTO del log', () => {
    expect(anchorPath(logPath)).not.toBe(logPath);
    expect(anchorPath(logPath)).toBe(`${logPath}.anchor`);
  });

  it('maybeAnchor NO duplica anclas si el intervalo no se cumplió', () => {
    maybeAnchor(logPath, 5, 'h1', 20);
    maybeAnchor(logPath, 10, 'h2', 20); // delta=5 < 20 → no debería anclar de nuevo
    expect(readAnchors(logPath)).toHaveLength(1);
  });

  it('maybeAnchor SÍ ancla de nuevo tras superar el intervalo', () => {
    maybeAnchor(logPath, 5, 'h1', 20);
    maybeAnchor(logPath, 30, 'h2', 20); // delta=25 >= 20 → nuevo ancla
    expect(readAnchors(logPath)).toHaveLength(2);
  });

  it('checkAnchorIntegrity: log intacto tras ancla → ok', () => {
    const lines = ['a', 'b', 'c'];
    const chain = buildChain(lines, GENESIS);
    writeLines(lines);
    appendAnchor(logPath, { lineCount: 3, chainHash: chain[2].chainHash, ts: new Date().toISOString() });
    const result = checkAnchorIntegrity(logPath);
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('ok');
  });

  it('checkAnchorIntegrity: log con MÁS líneas que el ancla (crecimiento normal) → ok', () => {
    const lines3 = ['a', 'b', 'c'];
    const chain3 = buildChain(lines3, GENESIS);
    writeLines(lines3);
    appendAnchor(logPath, { lineCount: 3, chainHash: chain3[2].chainHash, ts: new Date().toISOString() });
    // El log crece normalmente (nuevas líneas al final).
    writeLines(['a', 'b', 'c', 'd', 'e']);
    const result = checkAnchorIntegrity(logPath);
    expect(result.ok).toBe(true);
  });

  it('checkAnchorIntegrity: TRUNCADO (líneas borradas del final) → detectado + alerta ruidosa', () => {
    const lines5 = ['a', 'b', 'c', 'd', 'e'];
    const chain5 = buildChain(lines5, GENESIS);
    writeLines(lines5);
    appendAnchor(logPath, { lineCount: 5, chainHash: chain5[4].chainHash, ts: new Date().toISOString() });

    // Simula un atacante borrando las últimas 2 líneas del log.
    writeLines(['a', 'b', 'c']);

    const result = checkAnchorIntegrity(logPath);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('truncated');
    expect(result.currentLineCount).toBe(3);
    expect(result.lastAnchor?.lineCount).toBe(5);
    // Alerta RUIDOSA — no silenciosa.
    expect(errSpy).toHaveBeenCalled();
    const msg = errSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(msg).toMatch(/TRUNCADO/i);
  });

  it('checkAnchorIntegrity: historia reescrita ANTES del punto anclado → detectado', () => {
    const lines5 = ['a', 'b', 'c', 'd', 'e'];
    const chain5 = buildChain(lines5, GENESIS);
    writeLines(lines5);
    appendAnchor(logPath, { lineCount: 5, chainHash: chain5[4].chainHash, ts: new Date().toISOString() });

    // Reescribe una línea temprana pero mantiene el mismo NÚMERO de líneas
    // (no es un truncado por conteo, pero rompe la cadena hasta el ancla).
    writeLines(['a', 'TAMPERED', 'c', 'd', 'e']);

    const result = checkAnchorIntegrity(logPath);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('chain_mismatch');
    expect(errSpy).toHaveBeenCalled();
  });

  it('checkAnchorIntegrity: log nuevo sin anclas previas → ok (no_anchors), no falsea alarma', () => {
    writeLines(['a']);
    const result = checkAnchorIntegrity(logPath);
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('no_anchors');
    expect(errSpy).not.toHaveBeenCalled();
  });
});
