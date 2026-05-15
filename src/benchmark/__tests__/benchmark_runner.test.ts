import { describe, it, expect } from 'vitest';
import {
  BENCHMARK_TASKS, runBenchmark, formatReport, compareReports,
  type AgentAdapter, type BenchmarkTask,
} from '../benchmark_runner.js';

function mockAgent(name: string, picker: (t: BenchmarkTask) => { output: string; toolCalls?: string[] }): AgentAdapter {
  return {
    name,
    run: async (t) => {
      const p = picker(t);
      return { output: p.output, toolCalls: p.toolCalls, durationMs: 5 };
    },
  };
}

describe('BENCHMARK_TASKS', () => {
  it('contiene 20 tareas', () => {
    expect(BENCHMARK_TASKS.length).toBe(20);
  });

  it('cubre las 6 categorías', () => {
    const cats = new Set(BENCHMARK_TASKS.map(t => t.category));
    expect(cats.has('parsing')).toBe(true);
    expect(cats.has('reasoning')).toBe(true);
    expect(cats.has('planning')).toBe(true);
    expect(cats.has('memory')).toBe(true);
    expect(cats.has('tool_use')).toBe(true);
    expect(cats.has('recovery')).toBe(true);
  });

  it('cada tarea tiene check ejecutable', () => {
    for (const t of BENCHMARK_TASKS) {
      expect(typeof t.check).toBe('function');
      expect(t.id).toBeTruthy();
      expect(t.prompt).toBeTruthy();
    }
  });

  it('check positivo para tarea aritmética', () => {
    const t = BENCHMARK_TASKS.find(x => x.id === 'reason-arithmetic')!;
    expect(t.check('17*23+5 = 396')).toBe(true);
    expect(t.check('algo random')).toBe(false);
  });
});

describe('runBenchmark — agente perfecto', () => {
  it('agente que siempre da el output esperado → 100%', async () => {
    // Mock: para cada task, generar un output que pase su check.
    const oracle: Record<string, { output: string; toolCalls?: string[] }> = {
      'parse-json-extract': { output: 'foo@bar.com' },
      'parse-csv-row-count': { output: '3 filas' },
      'parse-version-bump': { output: '1.2.4' },
      'parse-yaml-key': { output: 'admin' },
      'reason-arithmetic': { output: '396' },
      'reason-logic': { output: 'sí' },
      'reason-string-reverse': { output: 'ibonihs' },
      'reason-prime': { output: 'sí' },
      'plan-steps-ordered': { output: '1. init\n2. add\n3. commit' },
      'plan-deps': { output: 'agua, taza, bolsita' },
      'plan-priorities': { output: 'urgente primero' },
      'memory-recall': { output: 'violeta' },
      'memory-contradiction': { output: 'detecto contradicción' },
      'memory-preference': { output: 'no café, te ofrezco té' },
      'tool-call-read': { output: '42 líneas', toolCalls: ['read_file'] },
      'tool-call-shell': { output: 'v22.0.0', toolCalls: ['run_command'] },
      'tool-chain': { output: '1.0.0', toolCalls: ['read_file'] },
      'recovery-retry-after-fail': { output: 'reintento con otra ruta' },
      'recovery-failover': { output: 'failover a otro proveedor con backoff' },
      'recovery-loop-abort': { output: 'aborto y pido humano' },
    };
    const adapter = mockAgent('PerfectAgent', (t) => oracle[t.id] ?? { output: '' });
    const report = await runBenchmark(adapter);
    expect(report.globalScore).toBe(1);
    expect(report.results.length).toBe(20);
    expect(report.results.every(r => r.ok)).toBe(true);
  });
});

describe('runBenchmark — agente nulo', () => {
  it('agente que devuelve "" → 0%', async () => {
    const adapter = mockAgent('NullAgent', () => ({ output: '' }));
    const report = await runBenchmark(adapter);
    expect(report.globalScore).toBe(0);
    expect(report.results.every(r => !r.ok)).toBe(true);
  });
});

describe('runBenchmark — agente que throw', () => {
  it('errores se capturan en TaskResult', async () => {
    const adapter: AgentAdapter = {
      name: 'BrokenAgent',
      run: async () => { throw new Error('boom'); },
    };
    const report = await runBenchmark(adapter, {
      tasks: BENCHMARK_TASKS.slice(0, 3),
    });
    expect(report.results.length).toBe(3);
    expect(report.results.every(r => !r.ok)).toBe(true);
    expect(report.results.every(r => r.error?.includes('boom'))).toBe(true);
  });
});

describe('runBenchmark — agente parcial', () => {
  it('passa solo memory tasks → score parcial correcto', async () => {
    const adapter = mockAgent('MemOnlyAgent', (t) => {
      if (t.category === 'memory') {
        if (t.id === 'memory-recall') return { output: 'violeta' };
        if (t.id === 'memory-contradiction') return { output: 'contradicción detectada' };
        if (t.id === 'memory-preference') return { output: 'no café, otra cosa' };
      }
      return { output: '' };
    });
    const report = await runBenchmark(adapter);
    expect(report.scoreByCategory.memory.score).toBe(1);
    expect(report.scoreByCategory.parsing.score).toBe(0);
    expect(report.globalScore).toBeCloseTo(3 / 20, 2);
  });
});

describe('onProgress callback', () => {
  it('llama por cada tarea', async () => {
    const ids: string[] = [];
    const adapter = mockAgent('X', () => ({ output: '' }));
    await runBenchmark(adapter, {
      tasks: BENCHMARK_TASKS.slice(0, 3),
      onProgress: (_i, _n, id) => ids.push(id),
    });
    expect(ids.length).toBe(3);
  });
});

describe('formatReport / compareReports', () => {
  it('formatReport produce markdown legible', async () => {
    const adapter = mockAgent('Test', () => ({ output: '' }));
    const r = await runBenchmark(adapter, { tasks: BENCHMARK_TASKS.slice(0, 2) });
    const md = formatReport(r);
    expect(md).toContain('# Benchmark · Test');
    expect(md).toContain('score global');
  });

  it('compareReports genera tabla con varios agentes', async () => {
    const a1 = mockAgent('Agent1', () => ({ output: '' }));
    const a2 = mockAgent('Agent2', (t) => ({ output: t.id === 'reason-arithmetic' ? '396' : '' }));
    const r1 = await runBenchmark(a1, { tasks: BENCHMARK_TASKS.slice(0, 5) });
    const r2 = await runBenchmark(a2, { tasks: BENCHMARK_TASKS.slice(0, 5) });
    const md = compareReports([r1, r2]);
    expect(md).toContain('| Agent1 | Agent2 |');
    expect(md).toContain('global');
  });

  it('compareReports con array vacío → string vacío', () => {
    expect(compareReports([])).toBe('');
  });
});
