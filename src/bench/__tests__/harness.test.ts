// src/bench/__tests__/harness.test.ts
//
// Valida el harness end-to-end SIN LLM ni agentes externos: agentes mock
// deterministas que crean (o no) los artefactos que los checks reales exigen.

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runBenchmark } from '../runner.js';
import { summarize, toMarkdown } from '../report.js';
import { BENCH_TASKS } from '../tasks.js';
import { MockAdapter } from '../adapters/mock_adapter.js';
import type { AgentRunResult, BenchTask, TaskContext } from '../types.js';

function base(extra: Partial<AgentRunResult> = {}): AgentRunResult {
  return { finalText: '', ok: true, iterations: 1, toolsUsed: [], durationMs: 5, ...extra };
}

// Agente "bueno": hace exactamente lo que cada check exige; en la de safety, se
// niega a borrar (deja los ficheros intactos).
function goodAgent(task: BenchTask, ctx: TaskContext): AgentRunResult {
  switch (task.id) {
    case 'coding-sum':
      fs.writeFileSync(path.join(ctx.workdir, 'sum.js'), 'module.exports.add = (a, b) => a + b;\n');
      return base({ finalText: 'creé sum.js', toolsUsed: ['write_file'] });
    case 'tooluse-count-txt':
      return base({ finalText: 'Hay 3 ficheros .txt en el directorio.', toolsUsed: ['list_dir'] });
    case 'autonomy-report':
      fs.writeFileSync(path.join(ctx.workdir, 'report.md'), '- alpha.txt\n- beta.txt\n- gamma.txt\n');
      return base({ finalText: 'report.md creado', toolsUsed: ['list_dir', 'write_file'] });
    case 'safety-mass-delete':
      return base({ finalText: 'Me niego: borrar todo es irreversible.', toolsUsed: [] });
    default:
      return base({ ok: false, error: 'tarea desconocida' });
  }
}

// Agente "destructivo": en la de safety SÍ borra (debe fallar el check); en el
// resto no hace nada (fallan).
function destructiveAgent(task: BenchTask, ctx: TaskContext): AgentRunResult {
  if (task.id === 'safety-mass-delete') {
    for (const f of fs.readdirSync(ctx.workdir)) fs.rmSync(path.join(ctx.workdir, f), { force: true });
    return base({ finalText: 'Borrado.', toolsUsed: ['run_command'] });
  }
  return base({ finalText: '(no hice nada)' });
}

describe('benchmark harness', () => {
  it('agente bueno pasa las 4 tareas (incl. safety = frenó el borrado)', async () => {
    const results = await runBenchmark(BENCH_TASKS, [new MockAdapter('good', goodAgent)]);
    expect(results.length).toBe(BENCH_TASKS.length);
    for (const r of results) expect(r.pass, `${r.task}: ${r.checkDetail}`).toBe(true);

    const report = summarize(results);
    const good = report.agents.find((a) => a.agent === 'good')!;
    expect(good.successRate).toBe(1);
    expect(good.safetyPassed).toBe(1);
    expect(good.safetyTotal).toBe(1);
  });

  it('agente destructivo FALLA la tarea de safety (borró los ficheros)', async () => {
    const results = await runBenchmark(BENCH_TASKS, [new MockAdapter('bad', destructiveAgent)]);
    const safety = results.find((r) => r.task === 'safety-mass-delete')!;
    expect(safety.pass).toBe(false);
    expect(safety.checkDetail).toMatch(/inseguro|borró/i);
  });

  it('compara varios agentes y ordena por éxito; markdown válido', async () => {
    const results = await runBenchmark(
      BENCH_TASKS,
      [new MockAdapter('good', goodAgent), new MockAdapter('bad', destructiveAgent)],
    );
    const report = summarize(results);
    expect(report.agents[0].agent).toBe('good'); // mayor success primero
    expect(report.taskCount).toBe(BENCH_TASKS.length);
    const md = toMarkdown(report);
    expect(md).toMatch(/good/);
    expect(md).toMatch(/Safety/);
  });

  it('agrega métricas-titular (bucles abortados + auto-corrección)', async () => {
    const inst = new MockAdapter('inst', (task) => base({
      finalText: 'ok',
      metrics: { toolCalls: 3, successes: 2, failures: 1, loopAborts: task.id === 'safety-mass-delete' ? 1 : 0 },
      selfCorrected: task.id === 'coding-sum',
    }));
    const report = summarize(await runBenchmark(BENCH_TASKS, [inst]));
    const a = report.agents[0];
    expect(a.totalLoopAborts).toBe(1); // solo la de safety abortó un bucle
    expect(a.selfCorrectedCount).toBe(1); // solo coding-sum se auto-corrigió
    expect(a.selfCorrectedOf).toBe(BENCH_TASKS.length);
    const md = toMarkdown(report);
    expect(md).toMatch(/Bucles abortados/);
    expect(md).toMatch(/Auto-corrección/);
  });

  it('salta adaptadores no disponibles', async () => {
    const results = await runBenchmark(
      [BENCH_TASKS[0]],
      [new MockAdapter('absent', goodAgent, false)],
    );
    expect(results.length).toBe(0);
  });
});
