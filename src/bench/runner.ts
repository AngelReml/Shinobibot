// src/bench/runner.ts
//
// Orquestador del benchmark: por cada (tarea × agente), crea un workdir aislado,
// corre setup → agente → check determinista, y agrega BenchResult. Nunca lanza
// por un fallo de una celda (lo registra como error). Concurrencia acotada.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AgentAdapter, BenchResult, BenchTask, RunRecord, TaskContext } from './types.js';
import type { ProvenanceKeypair } from '../agents/provenance_v2.js';

export interface RunBenchmarkOptions {
  /** Celdas concurrentes (default 1: determinismo y aislamiento de coste). */
  concurrency?: number;
  /** Raíz para los workdirs (default <tmp>/shinobi-bench). */
  workRoot?: string;
  /** Salta adaptadores cuyo isAvailable() sea false (default true). */
  skipUnavailable?: boolean;
  /** Callback de progreso. */
  onResult?: (r: BenchResult) => void;
  /**
   * Repeticiones por celda para medir consistencia (pass^k).
   * 1 = comportamiento clásico (sin repetición). Default: 1.
   * Con k > 1, BenchResult.passK = true solo si TODAS las corridas pasaron.
   */
  repeat?: number;
  /**
   * Si se provee, emite un paquete SignedProvenance (F4.1) por celda.
   * El audit.jsonl se lee dentro de runOnce (antes de limpiar el workdir).
   * El paquete se guarda en outDir/<agent>_<taskId>_<ts>.json.
   */
  provenanceOpts?: {
    keypair: ProvenanceKeypair;
    /** Directorio donde se guardan los paquetes .json. Se crea si no existe. */
    outDir: string;
    /** Tarea → prompt real (para embeber en el paquete). Default: task.id */
    promptOf?: (task: BenchTask) => string;
  };
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

  const k = Math.max(1, Math.round(opts.repeat ?? 1));

  const provOpts = opts.provenanceOpts;
  if (provOpts) fs.mkdirSync(provOpts.outDir, { recursive: true });

  /** Ejecuta una sola corrida de (task, adapter) en un workdir fresco. */
  async function runOnce(task: BenchTask, adapter: AgentAdapter): Promise<BenchResult> {
    const workdir = fs.mkdtempSync(path.join(workRoot, `${slug(adapter.id)}_${slug(task.id)}_`));
    const ctx: TaskContext = { workdir, task };
    const t0 = Date.now();
    try {
      if (task.setup) await task.setup(ctx);
      const run = await adapter.run(task, ctx);
      let pass = false; let detail = '';
      try {
        const c = await task.check(ctx, run);
        pass = c.pass; detail = c.detail;
      } catch (e: any) {
        pass = false; detail = `check lanzó: ${e?.message ?? e}`;
      }

      // F4.1 — emitir paquete de provenance ANTES de que finally limpie el workdir.
      let provenancePath: string | undefined;
      if (provOpts && run.ok) {
        try {
          const { buildSignedProvenance } = await import('../agents/provenance_v2.js');
          const prompt = provOpts.promptOf?.(task) ?? task.id;
          const pkg = buildSignedProvenance({
            taskId: task.id,
            prompt,
            finalText: run.finalText,
            auditPath: run.auditPath,
            verdict: { passed: pass, rationale: detail },
            embedAudit: true,
            privateKeyPem: provOpts.keypair.privateKeyPem,
            publicKeyPem: provOpts.keypair.publicKeyPem,
          });
          const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          provenancePath = path.join(provOpts.outDir, `${slug(adapter.id)}_${slug(task.id)}_${ts}.json`);
          fs.writeFileSync(provenancePath, JSON.stringify(pkg, null, 2));
        } catch { /* best-effort — no bloquea el resultado */ }
      }

      return {
        agent: adapter.id, task: task.id, category: task.category,
        pass, checkDetail: detail,
        durationMs: run.durationMs || (Date.now() - t0),
        iterations: run.iterations, toolsUsed: run.toolsUsed,
        costUsd: run.cost?.usd,
        loopAborts: run.metrics?.loopAborts,
        selfCorrected: run.selfCorrected,
        error: run.error,
        provenancePath,
      };
    } catch (e: any) {
      return {
        agent: adapter.id, task: task.id, category: task.category,
        pass: false, checkDetail: 'no se ejecutó',
        durationMs: Date.now() - t0, iterations: 0, toolsUsed: [],
        error: e?.message ?? String(e),
      };
    } finally {
      try { fs.rmSync(workdir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }

  const results: BenchResult[] = [];
  await boundedPool(cells, opts.concurrency ?? 1, async ({ task, adapter }) => {
    if (k <= 1) {
      const result = await runOnce(task, adapter);
      results.push(result);
      opts.onResult?.(result);
      return;
    }

    // pass^k: correr k veces en workdirs independientes.
    const runRecords: RunRecord[] = [];
    let aggregated: BenchResult | null = null;
    for (let i = 0; i < k; i++) {
      const r = await runOnce(task, adapter);
      runRecords.push({ pass: r.pass, durationMs: r.durationMs, iterations: r.iterations, error: r.error });
      if (aggregated === null) aggregated = r;
    }
    const base = aggregated!;
    const passK = runRecords.every((r) => r.pass);
    const result: BenchResult = {
      ...base,
      // pass = pasó al menos una vez (pass@1); passK = pasó todas (pass^k).
      pass: runRecords.some((r) => r.pass),
      passK,
      runs: runRecords,
      durationMs: runRecords.reduce((s, r) => s + r.durationMs, 0),
      iterations: Math.round(runRecords.reduce((s, r) => s + r.iterations, 0) / k),
    };
    results.push(result);
    opts.onResult?.(result);
  });

  return results;
}
