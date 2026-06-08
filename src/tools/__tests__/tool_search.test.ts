// src/tools/__tests__/tool_search.test.ts
import { describe, it, expect } from 'vitest';
import toolSearchTool, { searchTools } from '../tool_search.js';
import type { Tool } from '../tool_registry.js';
import type { TrustReport } from '../../audit/trust_ledger.js';

const mk = (name: string, description: string, categories?: string[]): Tool => ({
  name, description, categories,
  parameters: { type: 'object', properties: {} },
  execute: async () => ({ success: true, output: '' }),
});

const report = (scores: Record<string, number>): TrustReport => ({
  fromEvents: 0,
  tools: Object.entries(scores).map(([tool, score]) => ({
    tool, calls: 1, successes: 1, failures: 0, successRate: 1, avgDurationMs: 1, score,
  })),
});
const EMPTY: TrustReport = { tools: [], fromEvents: 0 };

describe('searchTools (ToolSearch sobre E3)', () => {
  it('rankea por relevancia léxica y excluye lo que no casa', () => {
    const tools = [
      mk('read_file', 'Read a file from disk'),
      mk('web_search', 'Search the web'),
      mk('write_file', 'Write content to a file'),
    ];
    const res = searchTools('read file', tools, EMPTY);
    expect(res.map((r) => r.name)).toEqual(['read_file', 'write_file']);
    expect(res.find((r) => r.name === 'web_search')).toBeUndefined();
    expect(res[0].relevance).toBe(1);
  });

  it('el trust desempata/mejora el orden a igual relevancia', () => {
    const tools = [mk('file_b', 'handle a file'), mk('file_a', 'handle a file')];
    const res = searchTools('file', tools, report({ file_a: 0.9, file_b: 0.3 }));
    expect(res.map((r) => r.name)).toEqual(['file_a', 'file_b']); // misma relevancia, file_a más fiable
  });

  it('una tool muy relevante pero poco fiable cede ante una fiable algo menos relevante', () => {
    // flaky: match exacto en nombre (rel 1) pero trust 0.1
    // solid: match parcial (rel 0.5) pero trust 0.95
    const tools = [mk('deploy', 'deploy the app'), mk('deploy_safe', 'deploy the app safely with checks')];
    // query "deploy app": deploy → name[deploy] + desc[app] ... ambos casan fuerte.
    // Para forzar el cruce uso trustWeight alto.
    const res = searchTools('deploy', tools, report({ deploy: 0.1, deploy_safe: 0.95 }), { trustWeight: 0.6 });
    // deploy: rel 1*(0.4)=0.4 + 0.1*0.6=0.06 → 0.46
    // deploy_safe: 'deploy' hits name → rel 1*0.4=0.4 + 0.95*0.6=0.57 → 0.97
    expect(res[0].name).toBe('deploy_safe');
  });

  it('query vacía → todas ordenadas por trust', () => {
    const tools = [mk('a', 'x'), mk('b', 'y'), mk('c', 'z')];
    const res = searchTools('', tools, report({ a: 0.2, b: 0.9, c: 0.5 }));
    expect(res.map((r) => r.name)).toEqual(['b', 'c', 'a']);
  });

  it('sin coincidencias → vacío', () => {
    const res = searchTools('zzzzz', [mk('read_file', 'read a file')], EMPTY);
    expect(res).toEqual([]);
  });

  it('respeta el límite', () => {
    const tools = Array.from({ length: 8 }, (_, i) => mk(`file_${i}`, 'handle a file'));
    expect(searchTools('file', tools, EMPTY, { limit: 3 }).length).toBe(3);
  });
});

describe('tool_search (tool)', () => {
  it('encuentra herramientas registradas y formatea la salida', async () => {
    const res = await toolSearchTool.execute({ query: 'tool search' });
    expect(res.success).toBe(true);
    expect(res.output).toMatch(/tool_search/);
    expect(res.output).toMatch(/trust \d+%/);
  });
});
