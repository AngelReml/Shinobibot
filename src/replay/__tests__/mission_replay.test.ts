import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadAudit, timeline, summarize, dryRunReplay, formatSummary,
} from '../mission_replay.js';

let work: string;
let auditPath: string;

const SAMPLE = [
  { kind: 'tool_call', ts: '2026-05-14T10:00:00Z', tool: 'read_file', argsHash: 'a', argsPreview: '{}', success: true, durationMs: 12, sessionId: 'S1' },
  { kind: 'tool_call', ts: '2026-05-14T10:00:05Z', tool: 'read_file', argsHash: 'b', argsPreview: '{}', success: false, durationMs: 22, sessionId: 'S1', error: 'ENOENT' },
  { kind: 'failover', ts: '2026-05-14T10:00:10Z', from: 'anthropic', to: 'openai', reason: '429' },
  { kind: 'loop_abort', ts: '2026-05-14T10:00:15Z', tool: 'agent_loop', verdict: 'LOOP_DETECTED', argsHash: 'c', sessionId: 'S1' },
  { kind: 'tool_call', ts: '2026-05-14T10:00:20Z', tool: 'write_file', argsHash: 'd', argsPreview: '{}', success: true, durationMs: 8, sessionId: 'S2' },
];

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'shinobi-rep-'));
  auditPath = join(work, 'audit.jsonl');
  writeFileSync(auditPath, SAMPLE.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
});
afterEach(() => { try { if (existsSync(work)) rmSync(work, { recursive: true, force: true }); } catch {} });

describe('loadAudit', () => {
  it('carga todos los eventos', () => {
    const all = loadAudit({ auditLogPath: auditPath });
    expect(all.length).toBe(5);
  });
  it('filtra por sessionId', () => {
    const s1 = loadAudit({ auditLogPath: auditPath, sessionId: 'S1' });
    expect(s1.every(e => e.sessionId === 'S1')).toBe(true);
    expect(s1.length).toBe(3);
  });
  it('filtra por ventana temporal', () => {
    const win = loadAudit({
      auditLogPath: auditPath,
      fromTs: '2026-05-14T10:00:05Z',
      toTs: '2026-05-14T10:00:15Z',
    });
    expect(win.length).toBe(3);
  });
  it('throw si path no existe', () => {
    expect(() => loadAudit({ auditLogPath: join(work, 'no.jsonl') }))
      .toThrow(/not found/);
  });
  it('skipa líneas malformadas', () => {
    writeFileSync(auditPath, 'not-json\n' + JSON.stringify(SAMPLE[0]) + '\n', 'utf-8');
    const ev = loadAudit({ auditLogPath: auditPath });
    expect(ev.length).toBe(1);
  });
});

describe('timeline', () => {
  it('ordena por ts ascendente', () => {
    const t = timeline({ auditLogPath: auditPath });
    const tss = t.map(e => e.ts);
    expect(tss).toEqual([...tss].sort());
  });
});

describe('summarize', () => {
  it('calcula stats agregados', () => {
    const s = summarize({ auditLogPath: auditPath });
    expect(s.totalEvents).toBe(5);
    expect(s.toolCalls).toBe(3);
    expect(s.toolCallFails).toBe(1);
    expect(s.loopAborts).toBe(1);
    expect(s.failovers).toBe(1);
    expect(s.tools['read_file']?.calls).toBe(2);
    expect(s.tools['read_file']?.fails).toBe(1);
    expect(s.tools['write_file']?.calls).toBe(1);
  });

  it('formatSummary genera markdown', () => {
    const s = summarize({ auditLogPath: auditPath });
    const md = formatSummary(s);
    expect(md).toContain('# Replay Summary');
    expect(md).toContain('read_file');
  });
});

describe('dryRunReplay', () => {
  it('re-ejecuta solo tool_calls con executor mock', async () => {
    const calls: string[] = [];
    const res = await dryRunReplay(
      { auditLogPath: auditPath },
      async (e) => {
        calls.push(e.tool || '?');
        return { ok: !!e.success };
      }
    );
    expect(calls).toEqual(['read_file', 'read_file', 'write_file']);
    expect(res.length).toBe(3);
    expect(res.every(r => r.divergence === undefined)).toBe(true);
  });

  it('detecta divergencia cuando replay devuelve distinto a original', async () => {
    const res = await dryRunReplay(
      { auditLogPath: auditPath },
      async () => ({ ok: true }) // siempre ok
    );
    // El 2º evento original falló pero replay dice ok → divergencia.
    const diverged = res.filter(r => r.divergence);
    expect(diverged.length).toBe(1);
    expect(diverged[0].divergence).toContain('original.success=false');
  });

  it('executor que throw se convierte en ok=false', async () => {
    const res = await dryRunReplay(
      { auditLogPath: auditPath },
      async () => { throw new Error('boom'); }
    );
    expect(res.every(r => r.ok === false)).toBe(true);
  });
});
