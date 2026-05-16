import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  LoopDetector,
  reduceOutputForFingerprint,
  loopDetectorConfigFromEnv,
} from '../loop_detector.js';

describe('reduceOutputForFingerprint', () => {
  it('normaliza timestamps + duraciones', () => {
    const a = 'opened at 2026-05-14T10:30:45.123Z took 12ms';
    const b = 'opened at 2026-05-14T11:00:00.000Z took 9.5ms';
    expect(reduceOutputForFingerprint(a)).toBe(reduceOutputForFingerprint(b));
  });
  it('normaliza paths Windows', () => {
    const a = 'Read C:\\Users\\foo\\a.txt OK';
    const b = 'Read C:/Users/bar/b.txt OK';
    expect(reduceOutputForFingerprint(a)).toBe(reduceOutputForFingerprint(b));
  });
  it('normaliza hex hashes largos', () => {
    const a = 'hash deadbeefdeadbeefdeadbeefdeadbeef OK';
    const b = 'hash cafebabecafebabecafebabecafebabe OK';
    expect(reduceOutputForFingerprint(a)).toBe(reduceOutputForFingerprint(b));
  });
  it('normaliza timestamps Unix', () => {
    expect(reduceOutputForFingerprint('t 1700000000 ok')).toBe(reduceOutputForFingerprint('t 1800000000 ok'));
  });
  it('null/undefined/vacío → ""', () => {
    expect(reduceOutputForFingerprint(null)).toBe('');
    expect(reduceOutputForFingerprint(undefined)).toBe('');
    expect(reduceOutputForFingerprint('')).toBe('');
  });
  it('outputs realmente distintos → fingerprints distintos', () => {
    const a = reduceOutputForFingerprint('success: read 42 bytes');
    const b = reduceOutputForFingerprint('error: file not found');
    expect(a).not.toBe(b);
  });
  it('trunca a maxLen', () => {
    expect(reduceOutputForFingerprint('x'.repeat(500), 50).length).toBe(50);
  });
});

describe('LoopDetector — capa de args', () => {
  it('1er intento no aborta, 2º idéntico aborta con LOOP_DETECTED', () => {
    const d = new LoopDetector();
    expect(d.recordCallAttempt('run_command', { cmd: 'X' }).abort).toBe(false);
    const r2 = d.recordCallAttempt('run_command', { cmd: 'X' });
    expect(r2.abort).toBe(true);
    expect(r2.verdict).toBe('LOOP_DETECTED');
    expect(r2.reason).toBe('args_repeated');
    expect(r2.hash).toBeTruthy();
  });
  it('args distintos no abortan', () => {
    const d = new LoopDetector();
    d.recordCallAttempt('t', { x: 1 });
    expect(d.recordCallAttempt('t', { x: 2 }).abort).toBe(false);
  });
  it('tools distintas no abortan', () => {
    const d = new LoopDetector();
    d.recordCallAttempt('t', { x: 1 });
    expect(d.recordCallAttempt('s', { x: 1 }).abort).toBe(false);
  });
  it('maxRepeatArgs configurable', () => {
    const d = new LoopDetector({ maxRepeatArgs: 3 });
    d.recordCallAttempt('t', { x: 1 });
    d.recordCallAttempt('t', { x: 1 });
    expect(d.recordCallAttempt('t', { x: 1 }).abort).toBe(true);
  });
});

describe('LoopDetector — capa semántica', () => {
  it('3 outputs indistinguibles abortan con LOOP_NO_PROGRESS', () => {
    const d = new LoopDetector();
    const o1 = '{"success":false,"error":"timeout 2026-05-14T10:00:00Z after 5000ms"}';
    const o2 = '{"success":false,"error":"timeout 2026-05-14T11:00:00Z after 5012ms"}';
    const o3 = '{"success":false,"error":"timeout 2026-05-14T12:00:00Z after 4980ms"}';
    expect(d.recordCallResult('web_search', o1).abort).toBe(false);
    expect(d.recordCallResult('web_search', o2).abort).toBe(false);
    const r3 = d.recordCallResult('web_search', o3);
    expect(r3.abort).toBe(true);
    expect(r3.verdict).toBe('LOOP_NO_PROGRESS');
    expect(r3.reason).toBe('output_repeated');
  });
  it('outputs distintos no abortan', () => {
    const d = new LoopDetector();
    d.recordCallResult('rf', 'content A');
    d.recordCallResult('rf', 'content B');
    expect(d.recordCallResult('rf', 'content C').abort).toBe(false);
  });
  it('aislamiento por tool', () => {
    const d = new LoopDetector();
    d.recordCallResult('toolA', 'same');
    d.recordCallResult('toolB', 'same');
    expect(d.recordCallResult('toolC', 'same').abort).toBe(false);
  });
});

describe('LoopDetector — capa 3 (modo de fallo de entorno)', () => {
  it('3 fallos del mismo modo abortan con LOOP_SAME_FAILURE (contador acumulativo)', () => {
    const d = new LoopDetector();
    expect(d.recordOutcome('t1', false, 'No browser on port 9222').abort).toBe(false);
    expect(d.recordOutcome('t2', false, 'devtools port closed').abort).toBe(false);
    const r = d.recordOutcome('t3', false, 'cdp connection refused');
    expect(r.abort).toBe(true);
    expect(r.verdict).toBe('LOOP_SAME_FAILURE');
    expect(r.reason).toBe('env_failure:browser_unavailable');
  });
  it('los éxitos intercalados NO resetean el contador acumulativo', () => {
    const d = new LoopDetector();
    d.recordOutcome('t', false, 'No browser on port 9222');
    d.recordOutcome('t', true);                       // éxito intercalado
    d.recordOutcome('t', false, 'No browser on port 9222');
    d.recordOutcome('t', true);                       // otro éxito intercalado
    expect(d.recordOutcome('t', false, 'No browser on port 9222').abort).toBe(true);
  });
  it('un fallo no clasificable intercalado NO resetea el contador', () => {
    const d = new LoopDetector();
    d.recordOutcome('t', false, 'No browser on port 9222');
    d.recordOutcome('t', false, 'bad argument');      // no-de-entorno, no cuenta
    d.recordOutcome('t', false, 'No browser on port 9222');
    expect(d.recordOutcome('t', false, 'No browser on port 9222').abort).toBe(true);
  });
  it('un fallo no clasificable solo, no aborta', () => {
    const d = new LoopDetector();
    expect(d.recordOutcome('t', false, 'bad argument').abort).toBe(false);
    expect(d.recordOutcome('t', true).abort).toBe(false);
  });
  it('la ventana deslizante aborta el clustering aunque el acumulativo sea alto', () => {
    const d = new LoopDetector({ maxSameFailureMode: 99, failureWindowSize: 4, failureWindowThreshold: 3 });
    d.recordOutcome('t', false, 'No browser on port 9222');
    d.recordOutcome('t', true);
    d.recordOutcome('t', false, 'No browser on port 9222');
    const r = d.recordOutcome('t', false, 'No browser on port 9222');
    expect(r.abort).toBe(true);
    expect(r.hash).toMatch(/^window:/);
  });
});

describe('loopDetectorConfigFromEnv', () => {
  beforeEach(() => {
    delete process.env.SHINOBI_LOOP_MAX_REPEAT_ARGS;
    delete process.env.SHINOBI_LOOP_MAX_SAME_OUTPUT;
    delete process.env.SHINOBI_LOOP_MAX_SAME_FAILURE;
  });
  afterEach(() => {
    delete process.env.SHINOBI_LOOP_MAX_REPEAT_ARGS;
    delete process.env.SHINOBI_LOOP_MAX_SAME_OUTPUT;
    delete process.env.SHINOBI_LOOP_MAX_SAME_FAILURE;
  });
  it('sin env → undefined', () => {
    const c = loopDetectorConfigFromEnv();
    expect(c.maxRepeatArgs).toBeUndefined();
    expect(c.maxSameOutput).toBeUndefined();
    expect(c.maxSameFailureMode).toBeUndefined();
  });
  it('env override', () => {
    process.env.SHINOBI_LOOP_MAX_REPEAT_ARGS = '5';
    process.env.SHINOBI_LOOP_MAX_SAME_OUTPUT = '7';
    process.env.SHINOBI_LOOP_MAX_SAME_FAILURE = '4';
    const c = loopDetectorConfigFromEnv();
    expect(c.maxRepeatArgs).toBe(5);
    expect(c.maxSameOutput).toBe(7);
    expect(c.maxSameFailureMode).toBe(4);
  });
  it('env inválida → undefined', () => {
    process.env.SHINOBI_LOOP_MAX_REPEAT_ARGS = 'abc';
    expect(loopDetectorConfigFromEnv().maxRepeatArgs).toBeUndefined();
  });
});
