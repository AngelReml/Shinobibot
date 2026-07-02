import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, existsSync, unlinkSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  logToolCall,
  logLoopAbort,
  logFailover,
  _internals,
} from '../audit_log.js';
import { verifyChain } from '../audit_chain.js';

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
    // Bajo tmpdir (no en la raíz del repo): en algunos filesystems el path
    // SÍ se acepta y escribe de verdad, y no queremos dejar cruft versionado.
    const invalidPath = join(tmpdir(), '<invalid>|*?.jsonl');
    process.env.SHINOBI_AUDIT_LOG_PATH = invalidPath;
    try {
      expect(() =>
        logToolCall({ tool: 'x', args: {}, success: true, durationMs: 1 }),
      ).not.toThrow();
    } finally {
      if (existsSync(invalidPath)) {
        try { unlinkSync(invalidPath); } catch {}
      }
    }
  });
});

// CRIT-06/ALTA-08 — hash-chain conectado a la escritura + verifyChain deja
// de ser no-op. Reproduce el hallazgo real: antes de este fix, writeAuditEvent
// llamaba appendFileSync directo sin construir ningún chainHash, así que estas
// aserciones fallaban (las líneas no traían prevHash/chainHash en absoluto).
describe('audit_log hash-chain (CRIT-06/ALTA-08)', () => {
  function rawLines(): string[] {
    return readFileSync(tmpLogPath, 'utf-8').split('\n').filter(Boolean);
  }

  it('cada línea escrita lleva su propio prevHash/chainHash encadenado', () => {
    logToolCall({ tool: 'a', args: { x: 1 }, success: true, durationMs: 1 });
    logToolCall({ tool: 'b', args: { x: 2 }, success: true, durationMs: 2 });
    logToolCall({ tool: 'c', args: { x: 3 }, success: false, durationMs: 3, error: 'boom' });
    const events = readEvents();
    expect(events).toHaveLength(3);
    for (const e of events) {
      expect(typeof e.prevHash).toBe('string');
      expect(e.chainHash).toMatch(/^[0-9a-f]{64}$/);
    }
    // Encadenado: el prevHash de la línea N+1 es el chainHash de la línea N.
    expect(events[1].prevHash).toBe(events[0].chainHash);
    expect(events[2].prevHash).toBe(events[1].chainHash);
  });

  it('verifyChain (sin referencia) auto-verifica la cadena embebida — íntegra pasa', () => {
    logToolCall({ tool: 'a', args: {}, success: true, durationMs: 1 });
    logToolCall({ tool: 'b', args: {}, success: true, durationMs: 1 });
    const v = verifyChain(rawLines());
    expect(v.valid).toBe(true);
    expect(v.reason).toBe('ok');
  });

  it('verifyChain detecta una línea manipulada exactamente en su índice', () => {
    logToolCall({ tool: 'a', args: {}, success: true, durationMs: 1 });
    logToolCall({ tool: 'b', args: {}, success: true, durationMs: 1 });
    logToolCall({ tool: 'c', args: {}, success: true, durationMs: 1 });
    const lines = rawLines();
    // Manipula la línea del medio (cambia el nombre de la tool) SIN
    // recalcular su chainHash — exactamente lo que haría un atacante editando
    // el fichero a mano.
    const tampered = lines.slice();
    const obj = JSON.parse(tampered[1]);
    obj.tool = 'hijacked_tool';
    tampered[1] = JSON.stringify(obj);
    const v = verifyChain(tampered);
    expect(v.valid).toBe(false);
    expect(v.brokenAt).toBe(1);
    expect(v.reason).toBe('tampered_line');
  });

  it('verifyChain marca missing_chain ante líneas sin prevHash/chainHash (inyectadas)', () => {
    const injected = ['{"kind":"tool_call","tool":"fake","success":true}'];
    const v = verifyChain(injected);
    expect(v.valid).toBe(false);
    expect(v.brokenAt).toBe(0);
    expect(v.reason).toBe('missing_chain');
  });

  it('persiste el head en <path>.chainhead.json y lo reusa', () => {
    logToolCall({ tool: 'a', args: {}, success: true, durationMs: 1 });
    const headPath = _internals.chainHeadPath(_internals.resolveLogPath());
    expect(existsSync(headPath)).toBe(true);
    const head = JSON.parse(readFileSync(headPath, 'utf-8'));
    const event = readEvents()[0];
    expect(head.chainHash).toBe(event.chainHash);
  });

  it('getChainHead recupera el head desde un .chainhead.json existente (path nunca visto)', () => {
    const dir = join(tmpdir(), `shinobi-chainhead-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    const freshPath = join(dir, 'audit.jsonl');
    const fakeHash = 'a'.repeat(64);
    writeFileSync(`${freshPath}.chainhead.json`, JSON.stringify({ chainHash: fakeHash }));
    expect(_internals.getChainHead(freshPath)).toBe(fakeHash);
    rmSync(dir, { recursive: true, force: true });
  });

  it('getChainHead recupera el head desde la última línea del log si falta el head file', () => {
    const dir = join(tmpdir(), `shinobi-chainhead2-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    const freshPath = join(dir, 'audit.jsonl');
    const fakeHash = 'b'.repeat(64);
    writeFileSync(freshPath, JSON.stringify({ kind: 'tool_call', tool: 'x', prevHash: 'GENESIS', chainHash: fakeHash }) + '\n');
    expect(_internals.getChainHead(freshPath)).toBe(fakeHash);
    rmSync(dir, { recursive: true, force: true });
  });
});

// CRIT-07 — SHINOBI_AUDIT_DISABLED=1 ahora deja constancia visible (console.warn)
// la primera vez que se detecta en el proceso, en vez de apagar el audit en
// silencio absoluto. Usa un módulo fresco (vi.resetModules) para no depender
// del orden de ejecución de otros tests que ya pudieran haber disparado el
// warning una vez (el flag es a propósito de processo/módulo, no por test).
describe('audit_log SHINOBI_AUDIT_DISABLED deja constancia (CRIT-07)', () => {
  it('emite console.warn la PRIMERA vez y no se repite en llamadas siguientes', async () => {
    vi.resetModules();
    const fresh = await import('../audit_log.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      process.env.SHINOBI_AUDIT_DISABLED = '1';
      const ok1 = fresh.logToolCall({ tool: 'x', args: {}, success: true, durationMs: 1 });
      const ok2 = fresh.logToolCall({ tool: 'y', args: {}, success: true, durationMs: 1 });
      expect(ok1).toBe(false);
      expect(ok2).toBe(false);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toMatch(/\[SECURITY\]/);
      expect(warnSpy.mock.calls[0][0]).toMatch(/SHINOBI_AUDIT_DISABLED/);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
