// src/agents/swarm.ts
//
// Motor E4 — ENJAMBRE (fan-out de agentes con verificación).
//
// runSwarm ejecuta N tareas de agente con concurrencia ACOTADA, cada una
// opcionalmente cerrada por el bucle de auto-verificación (E1), y agrega los
// resultados. Es la base de la auto-mejora en paralelo: descomponer un objetivo
// en sub-tareas independientes, lanzarlas a la vez y quedarse solo con lo
// verificado.
//
// RESTRICCIÓN HONESTA (cwd global de shinobi): el paralelo es seguro para
// trabajo que NO muta el árbol compartido (research, análisis, verificación,
// lectura). Para tareas que ESCRIBEN ficheros, usa `concurrency: 1` y aislamiento
// por worktree por tarea — el paralelo real de mutaciones exige cwd por-llamada
// (deuda anotada del cimiento, prerrequisito de la orquestación Team completa).
//
// Aislamiento de fallos: una tarea que lanza no tumba el enjambre; se registra
// como `ok:false` y el resto continúa.

import { runAgentLoop, type LLMInvoker } from './agent_loop.js';
import { runVerifiedAgent } from './verified_agent.js';
import type { Verdict } from './verifier.js';

export interface SwarmTask {
  /** La instrucción de esta sub-tarea. */
  task: string;
  /** Etiqueta para correlación (default `task-<i>`). */
  label?: string;
  /** Caja de tools de esta tarea (override del default del swarm). */
  tools?: string[];
  /** System prompt de esta tarea (override del default del swarm). */
  systemPrompt?: string;
  /** Criterios de aceptación (modo verify). */
  criteria?: string;
}

export interface SwarmOptions {
  tasks: SwarmTask[];
  /** System prompt por defecto para todas las tareas. */
  systemPrompt?: string;
  /** Caja de tools por defecto para todas las tareas. */
  tools?: string[];
  /** Máximo de tareas en vuelo a la vez (default min(4, nº tareas); mínimo 1). */
  concurrency?: number;
  /** Si true, cada tarea pasa por el bucle de auto-verificación (E1). Default false. */
  verify?: boolean;
  invokeLLM?: LLMInvoker;
  verifyInvokeLLM?: LLMInvoker;
  model?: string;
  maxIterations?: number;
  /** Intentos en modo verify (default 2). */
  maxAttempts?: number;
}

export interface SwarmTaskResult {
  label: string;
  ok: boolean;
  output: string;
  /** Presente si verify=true. */
  verdict?: Verdict;
  error?: string;
  iterations?: number;
}

export interface SwarmResult {
  results: SwarmTaskResult[];
  total: number;
  succeeded: number;
  failed: number;
}

const DEFAULT_SYSTEM = 'Eres un agente de un enjambre, enfocado en UNA sub-tarea. Sé conciso y resuelve solo lo pedido.';

/** Pool con concurrencia acotada que PRESERVA el orden de `items` en la salida. */
async function boundedPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runnerCount = Math.max(1, Math.min(limit, items.length));
  const runners = Array.from({ length: runnerCount }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) break;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Ejecuta el enjambre. Nunca lanza por fallos de una tarea: los traduce a
 * `SwarmTaskResult.ok=false`. Devuelve los resultados en el MISMO orden que las
 * tareas de entrada.
 */
export async function runSwarm(options: SwarmOptions): Promise<SwarmResult> {
  const tasks = options.tasks ?? [];
  const concurrency = options.concurrency ?? Math.min(4, tasks.length || 1);

  const results = await boundedPool(tasks, concurrency, async (t, i): Promise<SwarmTaskResult> => {
    const label = t.label ?? `task-${i}`;
    const systemPrompt = t.systemPrompt ?? options.systemPrompt ?? DEFAULT_SYSTEM;
    const tools = t.tools ?? options.tools ?? [];
    try {
      if (options.verify) {
        const r = await runVerifiedAgent({
          task: t.task,
          systemPrompt,
          tools,
          criteria: t.criteria,
          label,
          maxAttempts: options.maxAttempts ?? 2,
          maxIterations: options.maxIterations,
          model: options.model,
          invokeLLM: options.invokeLLM,
          verifyInvokeLLM: options.verifyInvokeLLM,
        });
        return {
          label, ok: r.ok, output: r.output, verdict: r.verdict,
          error: r.ok ? undefined : (r.verdict.issues[0] ?? 'no aprobado'),
        };
      }
      const r = await runAgentLoop({
        task: t.task, systemPrompt, tools, label,
        maxIterations: options.maxIterations, model: options.model,
        invokeLLM: options.invokeLLM,
      });
      return {
        label, ok: r.ok, output: r.output, iterations: r.iterations,
        error: r.ok ? undefined : (r.error ?? r.verdict),
      };
    } catch (err: any) {
      return { label, ok: false, output: '', error: err?.message ?? String(err) };
    }
  });

  const succeeded = results.filter((r) => r.ok).length;
  return { results, total: results.length, succeeded, failed: results.length - succeeded };
}
