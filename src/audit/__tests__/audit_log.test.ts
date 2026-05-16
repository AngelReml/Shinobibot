import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  logToolCall,
  logLoopAbort,
  logFailover,
  _internals,
} from '../audit_log.js';

let tmpLogPath: string;

beforeEach(() => {
  const dir = join(tmpdir(), `shinobi-audit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tmpLogPath = join(dir, 'audit.jsonl');
  process.env.SHINOBI_AUDIT_LOG_PATH = tmpLogPath;
  delete process.env.SHINOBI_AUDIT_DISABLED;
});

afterEach(() => {
  if (existsSync(tmpLogPath)) {
    try { unlinkSync(tmpLogPath); } catch {}
  }
  delete process.env.SHINOBI_AUDIT_LOG_PATH;
  delete process.env.SHINOBI_AUDIT_DISABLED;
});

function readEvents(): any[] {
  if (!existsSync(tmpLogPath)) return [];
  return readFileSync(tmpLogPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

describe('audit_log helpers', () => {
  it('hashArgs es estable y determinista', () => {
    const a = _internals.hashArgs({ x: 1, y: 'foo' });
    const b = _internals.hashArgs({ x: 1, y: 'foo' });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });
  it('previewArgs trunca a 200 chars + marker', () => {
    const big = 'x'.repeat(500);
    const p = _internals.previewArgs({ big });
    expect(p.length).toBeLessThan(250);
    expect(p).toContain('…[+');
  });
  it('resolveLogPath usa SHINOBI_AUDIT_LOG_PATH si está set', () => {
    process.env.SHINOBI_AUDIT_LOG_PATH = '/tmp/foo.jsonl';
    expect(_internals.resolveLogPath()).toMatch(/foo\.jsonl$/);
  });
});

describe('audit_log.logToolCall', () => {
  it('escribe una línea JSONL con los campos esperados', () => {
    const ok = logToolCall({
      tool: 'run_command',
      args: { command: 'echo hi' },
      success: true,
      durationMs: 12.7,
    });
    expect(ok).toBe(true);
    const events = readEvents();
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.kind).toBe('tool_call');
    expect(e.tool).toBe('run_command');
    expect(e.success).toBe(true);
    expect(e.durationMs).toBe(13); // redondeado
    expect(e.argsHash).toHaveLength(64);
    expect(e.argsPreview).toContain('echo hi');
    expect(typeof e.ts).toBe('string');
    expect(() => new Date(e.ts).toISOString()).not.toThrow();
  });

  it('incluye error cuando success=false', () => {
    logToolCall({
      tool: 'run_command',
      args: { command: 'X' },
      success: false,
      durationMs: 5,
      error: 'fail reason',
    });
    const e = readEvents()[0];
    expect(e.success).toBe(false);
    expect(e.error).toBe('fail reason');
  });

  it('multiples eventos appendeados como JSONL', () => {
    logToolCall({ tool: 'a', args: {}, success: true, durationMs: 1 });
    logToolCall({ tool: 'b', args: {}, success: true, durationMs: 2 });
    logToolCall({ tool: 'c', args: {}, success: true, durationMs: 3 });
    const events = readEvents();
    expect(events).toHaveLength(3);
    expect(events.map(e => e.tool)).toEqual(['a', 'b', 'c']);
  });
});

describe('audit_log.logLoopAbort', () => {
  it('emite kind=loop_abort con verdict + hash', () => {
    logLoopAbort({
      tool: 'run_command',
      verdict: 'LOOP_DETECTED',
      args: { cmd: 'kill X' },
    });
    const e = readEvents()[0];
    expect(e.kind).toBe('loop_abort');
    expect(e.verdict).toBe('LOOP_DETECTED');
    expect(e.tool).toBe('run_command');
    expect(e.argsHash).toHaveLength(64);
  });
  it('acepta LOOP_NO_PROGRESS', () => {
    logLoopAbort({ tool: 'x', verdict: 'LOOP_NO_PROGRESS', args: {} });
    expect(readEvents()[0].verdict).toBe('LOOP_NO_PROGRESS');
  });
});

describe('audit_log.logFailover', () => {
  it('emite kind=failover con from/to/reason', () => {
    logFailover({ from: 'groq', to: 'openai', reason: 'rate limit' });
    const e = readEvents()[0];
    expect(e.kind).toBe('failover');
    expect(e.from).toBe('groq');
    expect(e.to).toBe('openai');
    expect(e.reason).toBe('rate limit');
  });
});

describe('audit_log.disabled mode', () => {
  it('SHINOBI_AUDIT_DISABLED=1 hace que no escriba nada', () => {
    process.env.SHINOBI_AUDIT_DISABLED = '1';
    const ok = logToolCall({ tool: 'x', args: {}, success: true, durationMs: 1 });
    expect(ok).toBe(false);
    expect(existsSync(tmpLogPath)).toBe(false);
  });
});

describe('audit_log no lanza si algo va mal', () => {
  it('un path con caracteres reservados de Windows (< > * | ?) no crashea', () => {
    // El contrato real: el audit es best-effort, jamás bloquea el flujo del
    // agente. La función puede devolver true (algunos OS aceptan el path) o
    // false (otros rechazan); lo importante es que NO LANCE.
    const reservedPath = '<invalid>|*?.jsonl';
    process.env.SHINOBI_AUDIT_LOG_PATH = reservedPath;
    expect(() =>
      logToolCall({ tool: 'x', args: {}, success: true, durationMs: 1 }),
    ).not.toThrow();
    // En Linux esos caracteres son válidos y el archivo se crea de verdad;
    // lo limpiamos para no dejar basura en el árbol del repo.
    try { unlinkSync(reservedPath); } catch {}
  });
});
