// src/audit/__tests__/trust_ledger.test.ts
//
// Tests del motor E3 (audit como sustrato → trust-scores). Funciones puras +
// carga real desde un audit.jsonl temporal + la tool trust_report.

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  computeToolTrust,
  parseAuditLines,
  rankToolNamesByTrust,
  loadTrustReport,
} from '../trust_ledger.js';
import trustReportTool from '../../tools/trust_report.js';

const tc = (tool: string, success: boolean, durationMs: number, error?: string, ts = '2026-06-08T00:00:00.000Z') =>
  ({ kind: 'tool_call', ts, tool, argsHash: 'h', argsPreview: '{}', success, durationMs, error }) as any;

describe('computeToolTrust', () => {
  it('agrega calls/successRate/avgDuration/score y ordena por score', () => {
    const events = [
      tc('read_file', true, 10), tc('read_file', true, 10), tc('read_file', true, 10),
      tc('run_command', true, 100),
      tc('run_command', false, 200, 'No browser on port 9222 (CDP)'),
      tc('run_command', false, 300, 'no browser available, port 9222'),
    ];
    const report = computeToolTrust(events);
    expect(report.fromEvents).toBe(6);
    const rf = report.tools.find((t) => t.tool === 'read_file')!;
    const rc = report.tools.find((t) => t.tool === 'run_command')!;
    expect(rf.calls).toBe(3);
    expect(rf.successRate).toBe(1);
    expect(rf.avgDurationMs).toBe(10);
    expect(rf.score).toBeCloseTo(0.8, 5); // (3+1)/(3+2)
    expect(rc.successRate).toBeCloseTo(1 / 3, 5);
    expect(rc.avgDurationMs).toBe(200); // (100+200+300)/3
    expect(rc.score).toBeCloseTo(0.4, 5); // (1+1)/(3+2)
    expect(rc.topFailureMode).toBe('browser_unavailable');
    // read_file (0.8) antes que run_command (0.4)
    expect(report.tools[0].tool).toBe('read_file');
  });

  it('suavizado de Laplace: una sola llamada exitosa NO da score 1', () => {
    const report = computeToolTrust([tc('x', true, 5)]);
    expect(report.tools[0].score).toBeCloseTo(2 / 3, 5); // (1+1)/(1+2)
  });

  it('ignora eventos que no son tool_call', () => {
    const events = [
      tc('a', true, 1),
      { kind: 'failover', ts: 't', from: 'p', to: 'q', reason: 'rate_limit' } as any,
      { kind: 'loop_abort', ts: 't', tool: 'a', verdict: 'LOOP_DETECTED', argsHash: 'h' } as any,
    ];
    expect(computeToolTrust(events).fromEvents).toBe(1);
  });
});

describe('parseAuditLines', () => {
  it('parsea JSONL y salta líneas corruptas', () => {
    const text = JSON.stringify(tc('a', true, 1)) + '\n' + 'no soy json {' + '\n\n' + JSON.stringify(tc('b', false, 2));
    const evs = parseAuditLines(text);
    expect(evs.length).toBe(2);
  });
});

describe('rankToolNamesByTrust', () => {
  it('ordena por score; las desconocidas quedan en neutro (0.5)', () => {
    const report = computeToolTrust([
      tc('read_file', true, 1), tc('read_file', true, 1), tc('read_file', true, 1), // score 0.8
      tc('run_command', false, 1, 'x'), tc('run_command', false, 1, 'x'), // score (0+1)/(2+2)=0.25
    ]);
    const ranked = rankToolNamesByTrust(['run_command', 'read_file', 'unknown_tool'], report);
    expect(ranked).toEqual(['read_file', 'unknown_tool', 'run_command']);
  });
});

describe('loadTrustReport + trust_report (tool)', () => {
  let logPath: string;
  afterEach(() => {
    delete process.env.SHINOBI_AUDIT_LOG_PATH;
    if (logPath) { try { fs.rmSync(logPath, { force: true }); } catch { /* */ } }
  });

  it('carga el report desde un audit.jsonl real en disco', () => {
    logPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-trust-')), 'audit.jsonl');
    const text = [tc('read_file', true, 10), tc('read_file', false, 20, 'enoent: no such file')].map((e) => JSON.stringify(e)).join('\n');
    fs.writeFileSync(logPath, text);
    const report = loadTrustReport(logPath);
    const rf = report.tools.find((t) => t.tool === 'read_file')!;
    expect(rf.calls).toBe(2);
    expect(rf.successes).toBe(1);
    expect(rf.topFailureMode).toBe('file_not_found');
  });

  it('la tool trust_report formatea el report', async () => {
    logPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-trust2-')), 'audit.jsonl');
    fs.writeFileSync(logPath, [tc('web_search', true, 50), tc('web_search', true, 60)].map((e) => JSON.stringify(e)).join('\n'));
    process.env.SHINOBI_AUDIT_LOG_PATH = logPath;
    const res = await trustReportTool.execute({});
    expect(res.success).toBe(true);
    expect(res.output).toMatch(/web_search/);
    expect(res.output).toMatch(/100% ok/);
  });

  it('la tool informa cuando no hay datos', async () => {
    process.env.SHINOBI_AUDIT_LOG_PATH = path.join(os.tmpdir(), 'no-existe-' + Math.random().toString(36).slice(2) + '.jsonl');
    const res = await trustReportTool.execute({});
    expect(res.success).toBe(true);
    expect(res.output).toMatch(/Sin datos/i);
  });
});
