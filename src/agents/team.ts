// src/agents/team.ts
//
// TEAM — paralelismo REAL de mutaciones (cierra la deuda del cimiento).
//
// Cada miembro del equipo corre en su PROPIO worktree git Y su propio contexto
// de ejecución (AsyncLocalStorage): sus escrituras de fichero se resuelven a su
// worktree, aisladas de las de los demás aunque corran a la vez. No hay
// process.chdir global → varios agentes pueden mutar ficheros EN PARALELO sin
// pisarse. Es la base de la auto-mejora en paralelo (E4 con mutación real).
//
// Seguridad: como cada agente corre sin gate de aprobación, su caja unlock-ea
// solo las escrituras CONFINADAS (write_file/edit_file, acotadas por validatePath
// al worktree); run_command sigue bloqueado (un shell no se confina con el
// contexto — eso requiere sandbox real, combinable en el futuro).
//
// Al terminar, los worktrees con cambios se CONSERVAN (rama propia) para que el
// supervisor los fusione; los que quedaron intactos se descartan.

import { runAgentLoop, type LLMInvoker } from './agent_loop.js';
import { runVerifiedAgent } from './verified_agent.js';
import { runInContext } from './exec_context.js';
import { WorktreeManager } from './worktree.js';
import { DESTRUCTIVE_TOOLS } from '../security/approval.js';
import type { Verdict } from './verifier.js';

const WORKTREE_SAFE = new Set(['write_file', 'edit_file']);

export interface TeamTask {
  task: string;
  label?: string;
  tools?: string[];
  systemPrompt?: string;
  criteria?: string;
}

export interface TeamOptions {
  tasks: TeamTask[];
  /** Mánager de worktrees (default uno sobre el cwd). */
  manager?: WorktreeManager;
  /** Caja de tools por defecto (las destructivas no-confinadas se filtran). */
  tools?: string[];
  systemPrompt?: string;
  /** Máx. miembros a la vez (default = nº tareas: paralelo total). */
  concurrency?: number;
  /** Verificar cada resultado con E1. Default false. */
  verify?: boolean;
  invokeLLM?: LLMInvoker;
  verifyInvokeLLM?: LLMInvoker;
  model?: string;
  maxIterations?: number;
  maxAttempts?: number;
  /** Descartar TODOS los worktrees al final (default false: conserva los que cambiaron). */
  discardWorktrees?: boolean;
}

export interface TeamMemberResult {
  label: string;
  ok: boolean;
  output: string;
  verdict?: Verdict;
  /** Rama del worktree si se conservó (tiene cambios). */
  branch?: string;
  worktreePath?: string;
  kept: boolean;
  error?: string;
}

export interface TeamResult {
  results: TeamMemberResult[];
  total: number;
  succeeded: number;
  failed: number;
  /** Ramas de worktree conservadas (con cambios) para fusionar. */
  keptBranches: string[];
}

const DEFAULT_SYSTEM = 'Eres un miembro de un equipo, enfocado en UNA sub-tarea en tu propio espacio de trabajo aislado. Sé conciso.';

async function boundedPool<T, R>(items: T[], limit: number, worker: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Ejecuta un equipo de agentes, cada uno aislado en su worktree+contexto, en
 * paralelo. Nunca lanza por fallo de un miembro. Resultados en orden de entrada.
 */
export async function runTeam(options: TeamOptions): Promise<TeamResult> {
  const tasks = options.tasks ?? [];
  const manager = options.manager ?? new WorktreeManager();
  const concurrency = options.concurrency ?? (tasks.length || 1);

  if (!manager.isGitRepo()) {
    return {
      results: tasks.map((t, i) => ({ label: t.label ?? `member-${i}`, ok: false, output: '', kept: false, error: 'Team requiere un repositorio git.' })),
      total: tasks.length, succeeded: 0, failed: tasks.length, keptBranches: [],
    };
  }

  const results = await boundedPool(tasks, concurrency, async (t, i): Promise<TeamMemberResult> => {
    const label = t.label ?? `member-${i}`;
    const systemPrompt = t.systemPrompt ?? options.systemPrompt ?? DEFAULT_SYSTEM;
    const requested = t.tools ?? options.tools ?? ['read_file', 'write_file', 'edit_file', 'list_dir', 'search_files'];
    const box = requested.filter((x) => !(DESTRUCTIVE_TOOLS.has(x) && !WORKTREE_SAFE.has(x)));

    let wt;
    try {
      wt = manager.create(label);
    } catch (err: any) {
      return { label, ok: false, output: '', kept: false, error: `no se pudo crear worktree: ${err?.message ?? err}` };
    }

    try {
      // El contexto ALS aísla cwd+workspaceRoot de este miembro: sus tools de
      // fichero resuelven a SU worktree, en paralelo con los demás.
      const run = () => options.verify
        ? runVerifiedAgent({
            task: t.task, systemPrompt, tools: box, criteria: t.criteria, label,
            maxAttempts: options.maxAttempts ?? 2, maxIterations: options.maxIterations,
            model: options.model, invokeLLM: options.invokeLLM, verifyInvokeLLM: options.verifyInvokeLLM,
          }).then((r) => ({ ok: r.ok, output: r.output, verdict: r.verdict as Verdict | undefined, error: r.ok ? undefined : (r.verdict.issues[0] ?? 'no aprobado') }))
        : runAgentLoop({
            task: t.task, systemPrompt, tools: box, label,
            maxIterations: options.maxIterations, model: options.model, invokeLLM: options.invokeLLM,
          }).then((r) => ({ ok: r.ok, output: r.output, verdict: undefined as Verdict | undefined, error: r.ok ? undefined : (r.error ?? r.verdict) }));

      const r = await runInContext({ cwd: wt.path, workspaceRoot: wt.path }, run);

      // Limpieza: descartar si se pidió, o conservar solo si quedó con cambios.
      let kept = false;
      if (options.discardWorktrees) {
        manager.remove(wt.path, true);
      } else {
        const clean = manager.isClean(wt.path);
        if (clean) manager.remove(wt.path, false);
        else kept = true;
      }

      return {
        label, ok: r.ok, output: r.output, verdict: r.verdict,
        branch: kept ? wt.branch : undefined, worktreePath: kept ? wt.path : undefined,
        kept, error: r.error,
      };
    } catch (err: any) {
      try { manager.remove(wt.path, true); } catch { /* ignore */ }
      return { label, ok: false, output: '', kept: false, error: err?.message ?? String(err) };
    }
  });

  const succeeded = results.filter((r) => r.ok).length;
  return {
    results, total: results.length, succeeded, failed: results.length - succeeded,
    keptBranches: results.filter((r) => r.kept && r.branch).map((r) => r.branch!),
  };
}
