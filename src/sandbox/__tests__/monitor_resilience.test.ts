// Robustez del Monitor de Referencia (post P1.E1-E2). Tres mejoras, cada una
// con su mutación (regla #2 del repo):
//   Mejora 1 — RESILIENCIA: un backend que LANZA no propaga; degrada a
//              `backend_faulted`.
//   Mejora 3 — HARDENING: timeoutMs inválido y target raw vacío ⇒ invalid_effect.
//   Mejora 2 — AUDIT: sink inyectable (default no-op), captura allow/deny,
//              redacta el target, recorta, y es fail-open ante un sink que lanza.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import * as os from 'node:os';
import {
  mediatedEffect,
  setEffectAuditSink,
  monitorStats,
  _resetMonitorStats,
  type EffectAuditRecord,
  type ShellEffect,
} from '../monitor.js';
import { sandboxRegistry, _resetSandboxRegistry, MockBackend } from '../registry.js';
import type { RunBackend, RunOutput } from '../types.js';

const shell = (over: Partial<ShellEffect> = {}): ShellEffect => ({
  kind: 'shell',
  rawCommandLine: true,
  target: 'echo hi',
  cwd: process.cwd(),
  timeoutMs: 5_000,
  backendId: 'mock',
  reversible: false,
  ...over,
});

describe('Mejora 1 — resiliencia: el monitor nunca propaga una excepción de backend', () => {
  beforeEach(() => { _resetSandboxRegistry(); _resetMonitorStats(); setEffectAuditSink(null); });
  afterEach(() => { _resetSandboxRegistry(); setEffectAuditSink(null); });

  it('un backend que LANZA en run() → EffectResult {ok:false, backend_faulted}, NO rechaza', async () => {
    const faulty: RunBackend = {
      id: 'mock', label: 'faulty', requiredEnvVars: () => [], isConfigured: () => true,
      async run(): Promise<RunOutput> { throw new Error('daemon murió a mitad'); },
    };
    sandboxRegistry().register(faulty);
    const res = await mediatedEffect(shell());   // no debe rechazar la promesa
    expect(res.ok).toBe(false);
    if (!res.ok) { expect(res.code).toBe('backend_faulted'); expect(res.detail).toContain('daemon murió'); }
    expect(monitorStats().mediated).toBe(0);
  });

  it('un backend que rechaza (promise rejection) tampoco propaga', async () => {
    const rejecting: RunBackend = {
      id: 'mock', label: 'rej', requiredEnvVars: () => [], isConfigured: () => true,
      run(): Promise<RunOutput> { return Promise.reject(new Error('conexión perdida')); },
    };
    sandboxRegistry().register(rejecting);
    const res = await mediatedEffect(shell());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('backend_faulted');
  });

  it('happy path intacto: un backend que resuelve normal sigue devolviendo ok', async () => {
    sandboxRegistry().register(new MockBackend({ id: 'mock', scriptedOutput: () => ({ stdout: 'ok', stderr: '', exitCode: 0 }) }));
    const res = await mediatedEffect(shell());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.run.stdout).toBe('ok');
    expect(monitorStats().mediated).toBe(1);
  });
});

describe('Mejora 3 — hardening de entrada del Effect', () => {
  beforeEach(() => { _resetSandboxRegistry(); _resetMonitorStats(); setEffectAuditSink(null); });
  afterEach(() => { _resetSandboxRegistry(); setEffectAuditSink(null); });

  it.each([NaN, Infinity, -Infinity, -1, -0.001])('timeoutMs inválido (%s) ⇒ invalid_effect, no ejecuta', async (t) => {
    let ran = 0;
    sandboxRegistry().register(new MockBackend({ id: 'mock', scriptedOutput: () => { ran++; return { stdout: '', stderr: '', exitCode: 0 }; } }));
    const res = await mediatedEffect(shell({ timeoutMs: t }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('invalid_effect');
    expect(ran).toBe(0);
  });

  it('timeoutMs=0 es legítimo (Node: sin timeout) ⇒ se permite', async () => {
    sandboxRegistry().register(new MockBackend({ id: 'mock' }));
    const res = await mediatedEffect(shell({ timeoutMs: 0 }));
    expect(res.ok).toBe(true);
  });

  it('rawCommandLine con target vacío/blanco ⇒ invalid_effect, no ejecuta', async () => {
    let ran = 0;
    sandboxRegistry().register(new MockBackend({ id: 'mock', scriptedOutput: () => { ran++; return { stdout: '', stderr: '', exitCode: 0 }; } }));
    for (const t of ['', '   ', '\n\t']) {
      const res = await mediatedEffect(shell({ target: t }));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('invalid_effect');
    }
    expect(ran).toBe(0);
  });
});

describe('Mejora 2 — audit de efectos vía sink inyectable', () => {
  beforeEach(() => { _resetSandboxRegistry(); _resetMonitorStats(); });
  afterEach(() => { _resetSandboxRegistry(); setEffectAuditSink(null); });

  it('default no-op: sin sink, el efecto corre sin side-effects de audit', async () => {
    setEffectAuditSink(null);
    sandboxRegistry().register(new MockBackend({ id: 'mock' }));
    const res = await mediatedEffect(shell());
    expect(res.ok).toBe(true);
  });

  it('captura efectos ALLOW y DENY con los campos correctos', async () => {
    const recs: EffectAuditRecord[] = [];
    setEffectAuditSink((r) => recs.push(r));
    sandboxRegistry().register(new MockBackend({ id: 'mock', scriptedOutput: () => ({ stdout: '', stderr: '', exitCode: 0 }) }));
    await mediatedEffect(shell({ target: 'echo hola', reversible: true }));       // allow
    await mediatedEffect(shell({ backendId: 'inexistente' }));                    // deny
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({ kind: 'shell', backendId: 'mock', decision: 'allow', reversible: true, success: true });
    expect(typeof recs[0].durationMs).toBe('number');
    expect(recs[1]).toMatchObject({ decision: 'deny', code: 'backend_unavailable', backendId: 'inexistente' });
  });

  it('redacta el target antes del sink (defensa en profundidad)', async () => {
    const recs: EffectAuditRecord[] = [];
    setEffectAuditSink((r) => recs.push(r));
    sandboxRegistry().register(new MockBackend({ id: 'mock' }));
    await mediatedEffect(shell({ target: 'aws configure set key AKIAIOSFODNN7EXAMPLE' }));
    expect(recs[0].targetPreview).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('recorta targets largos con marcador …[+N]', async () => {
    const recs: EffectAuditRecord[] = [];
    setEffectAuditSink((r) => recs.push(r));
    sandboxRegistry().register(new MockBackend({ id: 'mock' }));
    await mediatedEffect(shell({ target: 'echo ' + 'A'.repeat(1000) }));
    expect(recs[0].targetPreview.length).toBeLessThan(300);
    expect(recs[0].targetPreview).toMatch(/…\[\+\d+\]$/);
  });

  it('FAIL-OPEN: un sink que LANZA no rompe ni altera el efecto', async () => {
    setEffectAuditSink(() => { throw new Error('sink roto'); });
    sandboxRegistry().register(new MockBackend({ id: 'mock', scriptedOutput: () => ({ stdout: 'ok', stderr: '', exitCode: 0 }) }));
    const res = await mediatedEffect(shell());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.run.stdout).toBe('ok');
  });
});

describe('Mejora 2 — logEffect persiste al audit (hash-chain + kind effect)', () => {
  let dir: string;
  let prevPath: string | undefined;
  let prevDisabled: string | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(os.tmpdir(), 'shinobi_effaudit_'));
    prevPath = process.env.SHINOBI_AUDIT_LOG_PATH;
    prevDisabled = process.env.SHINOBI_AUDIT_DISABLED;
    process.env.SHINOBI_AUDIT_LOG_PATH = join(dir, 'audit.jsonl');
    delete process.env.SHINOBI_AUDIT_DISABLED;
  });
  afterEach(() => {
    if (prevPath === undefined) delete process.env.SHINOBI_AUDIT_LOG_PATH; else process.env.SHINOBI_AUDIT_LOG_PATH = prevPath;
    if (prevDisabled === undefined) delete process.env.SHINOBI_AUDIT_DISABLED; else process.env.SHINOBI_AUDIT_DISABLED = prevDisabled;
    rmSync(dir, { recursive: true, force: true });
  });

  it('escribe un evento kind=effect encadenado', async () => {
    const { logEffect } = await import('../../audit/audit_log.js');
    const ok = logEffect({ effectKind: 'shell', backendId: 'local', targetPreview: 'echo hola', reversible: false, decision: 'allow', success: true, durationMs: 3 });
    expect(ok).toBe(true);
    const lines = readFileSync(process.env.SHINOBI_AUDIT_LOG_PATH!, 'utf-8').trim().split('\n');
    const evt = JSON.parse(lines[lines.length - 1]);
    expect(evt.kind).toBe('effect');
    expect(evt.effectKind).toBe('shell');
    expect(evt.decision).toBe('allow');
    expect(typeof evt.chainHash).toBe('string');
    expect(typeof evt.prevHash).toBe('string');
  });
});
