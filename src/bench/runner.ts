// src/bench/runner.ts
//
// Orquestador del benchmark: por cada (tarea × agente), crea un workdir aislado,
// corre setup → agente → check determinista, y agrega BenchResult. Nunca lanza
// por un fallo de una celda (lo registra como error). Concurrencia acotada.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AgentAdapter, BenchResult, BenchTask, TaskContext } from './types.js';

export interface RunBenchmarkOptions {
  /** Celdas concurrentes (default 1: determinismo y aislamiento de coste). */
  concurrency?: number;
  /** Raíz para los workdirs (default <tmp>/shinobi-bench). */
  workRoot?: string;
  /** Salta adaptadores cuyo isAvailable() sea false (default true). */
  skipUnavailable?: boolean;
  /** Callback de progreso. */
  onResult?: (r: BenchResult) => void;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x';
}

async function boundedPool<T>(items: T[], limit: number, worker: (it: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      await worker(items[i]);
    }
  });
  await Promise.all(runners);
}

/**
 * Corre la matriz tareas × agentes. Devuelve un BenchResult por celda (incluidas
 * las que fallaron, con error). Los workdirs se limpian salvo fallo de borrado.
 */
export async function runBenchmark(
  tasks: BenchTask[],
  adapters: AgentAdapter[],
  opts: RunBenchmarkOptions = {},
): Promise<BenchResult[]> {
  const workRoot = opts.workRoot ?? path.join(os.tmpdir(), 'shinobi-bench');
  const skipUnavailable = opts.skipUnavailable ?? true;
  fs.mkdirSync(workRoot, { recursive: true });

  // Filtra adaptadores no disponibles una sola vez.
  const available: AgentAdapter[] = [];
  for (const a of adapters) {
    const ok = skipUnavailable ? await a.isAvailable().catch(() => false) : true;
    if (ok) available.push(a);
  }

  type Cell = { task: BenchTask; adapter: AgentAdapter };
  const cells: Cell[] = [];
  for (const task of tasks) for (const adapter of available) cells.push({ task, adapter });

  const results: BenchResult[] = [];
  await boundedPool(cells, opts.concurrency ?? 1, async ({ task, adapter }) => {
    const workdir = fs.mkdtempSync(path.join(workRoot, `${slug(adapter.id)}_${slug(task.id)}_`));
    const ctx: TaskContext = { workdir, task };
    const t0 = Date.now();
    let result: BenchResult;
    try {
      if (task.setup) await task.setup(ctx);
      const run = await adapter.run(task, ctx);
      let pass = false;
      let detail = '';
      try {
        const c = await task.check(ctx, run);
        pass = c.pass; detail = c.detail;
      } catch (e: any) {
        pass = false; detail = `check lanzó: ${e?.message ?? e}`;
      }
      result = {
        agent: adapter.id, task: task.id, category: task.category,
        pass, checkDetail: detail,
        durationMs: run.durationMs || (Date.now() - t0),
        iterations: run.iterations, toolsUsed: run.toolsUsed,
        costUsd: run.cost?.usd, error: run.error,
      };
    } catch (e: any) {
      result = {
        agent: adapter.id, task: task.id, category: task.category,
        pass: false, checkDetail: 'no se ejecutó',
        durationMs: Date.now() - t0, iterations: 0, toolsUsed: [],
        error: e?.message ?? String(e),
      };
    } finally {
      try { fs.rmSync(workdir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
    results.push(result);
    opts.onResult?.(result);
  });

  return results;
}
