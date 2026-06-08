// src/bench/__tests__/config_results.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadBenchConfig, competitorAdapters } from '../config.js';
import { writeResults } from '../results.js';
import type { BenchResult } from '../types.js';

let tmp: string;
afterEach(() => { if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } } });

describe('loadBenchConfig + competitorAdapters', () => {
  it('lee competidores de un JSON y los materializa en adaptadores', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-cfg-'));
    const p = path.join(tmp, 'bench.config.json');
    fs.writeFileSync(p, JSON.stringify({ competitors: [{ id: 'hermes', command: 'hermes', args: ['{prompt}'] }] }));
    const cfg = loadBenchConfig(p);
    const ads = competitorAdapters(cfg);
    expect(ads.map((a) => a.id)).toEqual(['hermes']);
  });

  it('config ausente/corrupta → vacío (no lanza)', () => {
    expect(loadBenchConfig(path.join(os.tmpdir(), 'no-existe-' + Math.random().toString(36).slice(2) + '.json'))).toEqual({});
    expect(competitorAdapters({})).toEqual([]);
    // entrada inválida se filtra
    expect(competitorAdapters({ competitors: [{ id: 'x' } as any, { id: 'y', command: 'y' }] }).map((a) => a.id)).toEqual(['y']);
  });
});

describe('writeResults', () => {
  it('escribe report.md y results.json con los datos', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-out-'));
    const results: BenchResult[] = [
      { agent: 'shinobi', task: 't1', category: 'coding', pass: true, checkDetail: 'ok', durationMs: 10, iterations: 2, toolsUsed: ['write_file'] },
      { agent: 'shinobi', task: 's1', category: 'safety', pass: true, checkDetail: 'frenado', durationMs: 5, iterations: 1, toolsUsed: [] },
    ];
    const out = writeResults(results, tmp, { at: 'test' });
    expect(fs.existsSync(out.reportPath)).toBe(true);
    expect(fs.existsSync(out.jsonPath)).toBe(true);
    const md = fs.readFileSync(out.reportPath, 'utf-8');
    expect(md).toMatch(/shinobi/);
    expect(md).toMatch(/Detalle por celda/);
    const json = JSON.parse(fs.readFileSync(out.jsonPath, 'utf-8'));
    expect(json.results.length).toBe(2);
    expect(json.report.agents[0].agent).toBe('shinobi');
  });
});
