/**
 * kaname/swarm.ts — KN-06: el orquestador del enjambre. Shinobi dirige N instancias
 * de Claude Code (subprocesos) en frentes DISJUNTOS, cada una en su propio workspace,
 * sin colisión. Dos roles: constructores (generan skills en userspace) y verificadores
 * (corren pruebas duras → salida cruda). La INTEGRACIÓN rechaza toda escritura a rutas
 * de núcleo (la frontera del §6 lo impide): el enjambre nunca toca el suelo (P4).
 *
 * El lanzamiento real de Claude Code (subproceso) es la parte viva ⚑ (inyectada);
 * el reparto, la integración y el bloqueo de escrituras al núcleo son deterministas.
 * Respeta un cap de concurrencia (§7.3 realismo: rate limits → cola/backoff).
 */

import { writeAllowed } from './immutability.js';
import { classifyZone } from './boundary.js';
import type { SwarmWorker } from './types.js';

export interface WorkerResult {
  worker_id: string;
  front: string;
  writes: string[];                  // rutas que el worker quiere escribir
  raw_output?: string;               // salida cruda (verificadores) — no resúmenes
  ok: boolean;
}

/** ⚑ live: lanzar Claude Code como subproceso con un prompt-tarea y recoger su salida. */
export type LaunchClaude = (worker: SwarmWorker, prompt: string) => Promise<WorkerResult>;

/** Assign disjoint fronts to builders, each in its own workspace (no collision). */
export function assignFronts(fronts: string[], role: 'builder' | 'verifier' = 'builder'): SwarmWorker[] {
  return fronts.map((front, i) => ({
    worker_id: `${role}_${i + 1}`,
    role,
    assigned_front: front,
    workspace: `worktree/${role}_${i + 1}`,        // worktree/rama/sandbox propio
    status: 'running',
  }));
}

/** Integration guard: core-path writes are BLOCKED; userspace writes accepted (P4). */
export function integrateWrites(writes: string[]): { accepted: string[]; blocked: string[] } {
  const accepted: string[] = [], blocked: string[] = [];
  for (const w of writes) (writeAllowed({ path: w, origin: 'swarm' }) ? accepted : blocked).push(w);
  return { accepted, blocked };
}

export interface SwarmRunResult {
  workers: SwarmWorker[];
  results: WorkerResult[];
  blocked_core_writes: { worker_id: string; path: string }[];   // intentos rechazados (logs de bloqueo)
}

/**
 * Orchestrate a build wave: assign disjoint fronts, launch builders in bounded
 * batches (concurrency cap = backoff/queue stand-in), integrate each result blocking
 * core writes. The core hash is never touched — the worst a worker does is have its
 * core-path write rejected at integration.
 */
export async function orchestrateSwarm(
  fronts: string[],
  deps: { launch: LaunchClaude; prompt: (front: string) => string; concurrency?: number; role?: 'builder' | 'verifier' },
): Promise<SwarmRunResult> {
  const workers = assignFronts(fronts, deps.role ?? 'builder');
  const cap = Math.max(1, deps.concurrency ?? 4);
  const results: WorkerResult[] = [];
  const blocked_core_writes: SwarmRunResult['blocked_core_writes'] = [];

  for (let i = 0; i < workers.length; i += cap) {
    const batch = workers.slice(i, i + cap);
    const batchResults = await Promise.all(batch.map(async (w) => {
      try { return await deps.launch(w, deps.prompt(w.assigned_front)); }
      catch (e: any) { return { worker_id: w.worker_id, front: w.assigned_front, writes: [], ok: false, raw_output: `launch error: ${e?.message ?? e}` } as WorkerResult; }
    }));
    for (const r of batchResults) {
      const { blocked } = integrateWrites(r.writes);
      for (const p of blocked) blocked_core_writes.push({ worker_id: r.worker_id, path: p });
      const w = workers.find((x) => x.worker_id === r.worker_id)!;
      w.status = r.ok && blocked.length === 0 ? 'done' : 'failed';
      results.push(r);
    }
  }
  return { workers, results, blocked_core_writes };
}
