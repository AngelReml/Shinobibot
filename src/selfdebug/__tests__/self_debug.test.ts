import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { diagnoseError, formatReport } from '../self_debug.js';

let work: string;
beforeEach(() => { work = mkdtempSync(join(tmpdir(), 'shinobi-dbg-')); });
afterEach(() => { try { if (existsSync(work)) rmSync(work, { recursive: true, force: true }); } catch {} });

describe('diagnoseError — patrones conocidos', () => {
  it('ENOENT → causa filesystem path', () => {
    const r = diagnoseError({
      tool: 'read_file',
      args: { path: '/nope' },
      error: "ENOENT: no such file or directory, open '/nope'",
    });
    expect(r.rootCauseHypotheses.some(h => /filesystem|recurso/i.test(h.cause))).toBe(true);
    expect(r.rootCauseHypotheses[0].confidence).toBeGreaterThan(0.7);
  });

  it('ECONNREFUSED → servicio no escuchando', () => {
    const r = diagnoseError({
      tool: 'http_call',
      args: { url: 'http://localhost:9999' },
      error: 'connect ECONNREFUSED 127.0.0.1:9999',
    });
    expect(r.rootCauseHypotheses[0].cause).toMatch(/escuchando|listening/i);
  });

  it('429 rate limit', () => {
    const r = diagnoseError({
      tool: 'llm_call',
      args: { provider: 'anthropic' },
      error: 'HTTP 429 too many requests',
    });
    expect(r.rootCauseHypotheses[0].cause).toMatch(/rate limit/i);
    expect(r.fixSuggestions[0].detail).toMatch(/failover|backoff/i);
  });

  it('401 unauthorized', () => {
    const r = diagnoseError({
      tool: 'llm_call',
      args: {},
      error: '401 Unauthorized — Invalid API key',
    });
    expect(r.rootCauseHypotheses[0].cause).toMatch(/api key/i);
  });

  it('SQLITE_BUSY → DB locked', () => {
    const r = diagnoseError({
      tool: 'task_store_save',
      args: {},
      error: 'SQLITE_BUSY: database is locked',
    });
    expect(r.rootCauseHypotheses[0].cause).toMatch(/lock|SQLite/i);
  });

  it('JSON parse error', () => {
    const r = diagnoseError({
      tool: 'llm_response_parse',
      args: {},
      error: 'Unexpected token < in JSON at position 0',
    });
    expect(r.rootCauseHypotheses[0].cause).toMatch(/JSON/i);
  });

  it('LOOP_DETECTED → loop detector', () => {
    const r = diagnoseError({
      tool: 'agent_loop',
      args: {},
      error: 'verdict=LOOP_DETECTED after 5 repetitions',
    });
    expect(r.rootCauseHypotheses[0].cause).toMatch(/loop detector/i);
    expect(r.rootCauseHypotheses[0].confidence).toBe(1);
  });

  it('error desconocido → fallback con confianza baja', () => {
    const r = diagnoseError({
      tool: 'whatever',
      args: {},
      error: 'Something totally unrecognized exploded internally.',
    });
    expect(r.rootCauseHypotheses[0].confidence).toBeLessThan(0.5);
    expect(r.fixSuggestions[0].action).toMatch(/inspeccionar/i);
  });
});

describe('correlación con audit.jsonl', () => {
  it('encuentra eventos pasados del mismo tool', () => {
    const audit = join(work, 'audit.jsonl');
    writeFileSync(audit, [
      JSON.stringify({ kind: 'tool_call', ts: '2026-05-14T10:00:00Z', tool: 'read_file', argsHash: 'a', success: false }),
      JSON.stringify({ kind: 'tool_call', ts: '2026-05-14T10:01:00Z', tool: 'read_file', argsHash: 'b', success: false }),
      JSON.stringify({ kind: 'tool_call', ts: '2026-05-14T10:02:00Z', tool: 'other_tool', argsHash: 'c', success: true }),
    ].join('\n') + '\n', 'utf-8');

    const r = diagnoseError({
      tool: 'read_file',
      args: { path: '/x' },
      error: 'ENOENT',
      auditLogPath: audit,
    });
    expect(r.relatedAuditEntries.length).toBe(2);
    expect(r.relatedAuditEntries.every(e => e.tool === 'read_file')).toBe(true);
  });

  it('soporta audit con líneas malformadas (skip)', () => {
    const audit = join(work, 'audit.jsonl');
    writeFileSync(audit,
      '{not-json}\n' +
      JSON.stringify({ kind: 'tool_call', ts: 't', tool: 'X', argsHash: 'a', success: false }) + '\n',
      'utf-8'
    );
    const r = diagnoseError({ tool: 'X', args: {}, error: 'oops', auditLogPath: audit });
    expect(r.relatedAuditEntries.length).toBe(1);
  });

  it('path inexistente → array vacío sin throw', () => {
    const r = diagnoseError({
      tool: 'x', args: {}, error: 'oops',
      auditLogPath: join(work, 'no_existe.jsonl'),
    });
    expect(r.relatedAuditEntries).toEqual([]);
  });
});

describe('formatReport', () => {
  it('genera markdown legible', () => {
    const r = diagnoseError({
      tool: 'read_file',
      args: {},
      error: 'ENOENT: no such file',
    });
    const md = formatReport(r);
    expect(md).toContain('# Self-Debug Report');
    expect(md).toContain('## Hipótesis de causa raíz');
    expect(md).toContain('## Sugerencias de fix');
  });
});
