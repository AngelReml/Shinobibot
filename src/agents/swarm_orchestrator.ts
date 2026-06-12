// src/agents/swarm_orchestrator.ts
//
// ORQUESTADOR DE ENJAMBRE — el cableado del cerebro (swarm_plan) al músculo (team).
//
// Cierra la deuda de DECISIONES 2026-06-10: pone el planificador DAG portado de
// swarm-ide ENCIMA del aislamiento-por-worktree + verificación + firma de Shinobi.
// Flujo:
//
//   tarea
//     │ planner LLM → JSON                  (makeLLMPlanner / inyectable)
//     ▼ parsePlan + schedule                (swarm_plan: DAG → lotes topológicos)
//   lotes paralelos
//     │ por cada lote → runTeam             (team.ts: worktree aislado, E1, E7)
//     │   inyectando la PIZARRA              (salidas de lotes previos por dependencia)
//     ▼ revisor = committee_review/verdict  (reviewRejected bloquea y para)
//   resultado fusionable + rastro
//
// Diseño testeable (patrón del repo: núcleo puro + runner inyectable, como
// worktree.ts inyecta git y cli_adapter inyecta spawn): `runBatch` por defecto es
// `runTeam`, pero se inyecta un doble en los tests para ejercitar TODA la lógica
// de orquestación (plan, lotes, pizarra, gate del revisor) sin git ni LLM.

import { runTeam, type TeamOptions, type TeamTask, type TeamResult, type TeamMemberResult } from './team.js';
import type { LLMInvoker } from './agent_loop.js';
import {
  parsePlan, schedule, reviewRejected, budgetExceeded, renderPlan,
  ROLE_TOOLS, ROLE_PROMPT, PLANNER_PROMPT, type PlannedSubTask,
} from './swarm_plan.js';

/** Devuelve el texto crudo del planner (el caller cablea su LLM). */
export type SwarmPlanner = (task: string) => Promise<string>;

/** Runner de un lote. Default = runTeam. Inyectable para tests. */
export type BatchRunner = (tasks: TeamTask[], opts: Omit<TeamOptions, 'tasks'>) => Promise<TeamResult>;

export type SwarmStatus = 'completed' | 'rejected' | 'budget_exceeded' | 'planning_failed';

export interface SwarmOrchestratedOptions {
  task: string;
  /** Planner LLM. Default: makeLLMPlanner(invokeLLM, model) si se pasa invokeLLM. */
  planner?: SwarmPlanner;
  invokeLLM?: LLMInvoker;
  verifyInvokeLLM?: LLMInvoker;
  model?: string;
  /** Verificar cada subtarea con E1 (default true: es la ventaja de Shinobi). */
  verify?: boolean;
  maxIterations?: number;
  /** Máx. subtareas EN PARALELO por lote (default = tamaño del lote). */
  concurrency?: number;
  /** Techo de coste USD acumulado (0 = ilimitado). Estimación por subtarea. */
  budgetUsd?: number;
  /** Coste estimado por subtarea (placeholder hasta cablear el coste real). */
  estCostPerTaskUsd?: number;
  /** Runner de lote (default runTeam). Inyectable para test. */
  runBatch?: BatchRunner;
}

export interface SwarmOrchestratedResult {
  status: SwarmStatus;
  plan: PlannedSubTask[];
  planRendered: string;
  batches: string[][]; // ids por lote, en orden de ejecución
  members: TeamMemberResult[];
  blackboard: Record<string, string>;
  keptBranches: string[];
  /** Si status='rejected', el id del revisor que bloqueó. */
  rejectedBy?: string;
  spentUsd: number;
}

/**
 * Compone el texto de una subtarea inyectando la PIZARRA: las salidas de sus
 * dependencias ya ejecutadas. Puro y testeable. Solo incluye deps presentes.
 */
export function composeWithBlackboard(subtask: PlannedSubTask, blackboard: Map<string, string>): string {
  const deps = subtask.dependsOn.filter((d) => blackboard.has(d));
  if (deps.length === 0) return subtask.goal;
  const ctx = deps
    .map((d) => `[${d}]\n${(blackboard.get(d) ?? '').trim().slice(0, 4000)}`)
    .join('\n\n');
  return (
    `Contexto de subtareas previas del enjambre (úsalo, no lo repitas):\n` +
    `<<<\n${ctx}\n>>>\n\n` +
    `Tu subtarea ahora: ${subtask.goal}`
  );
}

/** Adapta un LLMInvoker de Shinobi a un SwarmPlanner. Extrae el texto del
 *  CloudResponse.output (mensaje OpenAI-compatible en JSON), igual que agent_loop. */
export function makeLLMPlanner(invokeLLM: LLMInvoker, model?: string): SwarmPlanner {
  return async (task: string): Promise<string> => {
    const res = await invokeLLM({
      model,
      messages: [
        { role: 'system', content: 'Eres un planificador de enjambre. Respondes SOLO con el array JSON pedido.' },
        { role: 'user', content: PLANNER_PROMPT.replace('{task}', task) },
      ],
    } as Parameters<LLMInvoker>[0]);
    return extractContent((res as { output?: unknown }).output);
  };
}

/** Extrae `content` de un output que es (string JSON | objeto) mensaje OpenAI. */
function extractContent(output: unknown): string {
  if (output == null) return '';
  if (typeof output === 'string') {
    try {
      const parsed = JSON.parse(output);
      if (parsed && typeof parsed === 'object' && 'content' in parsed) {
        const c = (parsed as { content?: unknown }).content;
        return typeof c === 'string' ? c : (c == null ? '' : String(c));
      }
      return output;
    } catch { return output; }
  }
  if (typeof output === 'object' && 'content' in (output as object)) {
    const c = (output as { content?: unknown }).content;
    return typeof c === 'string' ? c : (c == null ? '' : String(c));
  }
  return String(output);
}

/** Fallback si el planner no produce un plan usable: una sola subtarea de coder. */
function singleCoderFallback(task: string): PlannedSubTask[] {
  return [{ id: 't1', goal: task, role: 'coder', dependsOn: [] }];
}

/**
 * Ejecuta el enjambre orquestado: planifica → schedula → corre por lotes con
 * pizarra → gate del revisor → agrega. Nunca lanza: cualquier fallo se refleja en
 * `status`. El núcleo de orquestación es determinista dado el planner y runBatch.
 */
export async function runSwarmOrchestrated(options: SwarmOrchestratedOptions): Promise<SwarmOrchestratedResult> {
  const planner = options.planner ?? (options.invokeLLM ? makeLLMPlanner(options.invokeLLM, options.model) : null);
  const runBatch: BatchRunner = options.runBatch ?? ((tasks, opts) => runTeam({ ...opts, tasks }));
  const verify = options.verify ?? true;
  const estCost = options.estCostPerTaskUsd ?? 0;
  const budget = options.budgetUsd ?? 0;

  // ── 1. Planificación ──
  let plan: PlannedSubTask[] = [];
  if (planner) {
    try { plan = parsePlan(await planner(options.task)); } catch { plan = []; }
  }
  if (plan.length === 0) plan = singleCoderFallback(options.task);

  // ── 2. Schedule topológico (si el plan tiene ciclo/dep mala → fallback) ──
  let batches: PlannedSubTask[][];
  let planningFailed = false;
  try {
    batches = schedule(plan);
  } catch {
    planningFailed = true;
    plan = singleCoderFallback(options.task);
    batches = [plan];
  }

  // ── 3. Ejecución por lotes con pizarra ──
  const blackboard = new Map<string, string>();
  const members: TeamMemberResult[] = [];
  const keptBranches: string[] = [];
  const batchIds: string[][] = [];
  let spentUsd = 0;
  let status: SwarmStatus = planningFailed ? 'planning_failed' : 'completed';
  let rejectedBy: string | undefined;

  outer: for (const batch of batches) {
    if (budgetExceeded(spentUsd, budget)) { status = 'budget_exceeded'; break; }
    batchIds.push(batch.map((s) => s.id));

    const teamTasks: TeamTask[] = batch.map((st) => ({
      task: composeWithBlackboard(st, blackboard),
      label: st.id,
      tools: ROLE_TOOLS[st.role],
      systemPrompt: ROLE_PROMPT[st.role],
    }));

    const res = await runBatch(teamTasks, {
      verify, invokeLLM: options.invokeLLM, verifyInvokeLLM: options.verifyInvokeLLM,
      model: options.model, maxIterations: options.maxIterations,
      concurrency: options.concurrency ?? batch.length,
    });
    spentUsd += batch.length * estCost;

    for (const m of res.results) {
      members.push(m);
      blackboard.set(m.label, m.output ?? '');
    }
    keptBranches.push(...res.keptBranches);

    // ── 4. Gate del revisor: si un revisor de este lote bloquea, paramos ──
    for (const st of batch) {
      if (st.role !== 'reviewer') continue;
      const out = blackboard.get(st.id) ?? '';
      if (reviewRejected(out)) { status = 'rejected'; rejectedBy = st.id; break outer; }
    }
  }

  if (status === 'planning_failed' && members.every((m) => m.ok)) status = 'completed';

  return {
    status,
    plan,
    planRendered: renderPlan(plan),
    batches: batchIds,
    members,
    blackboard: Object.fromEntries(blackboard),
    keptBranches,
    rejectedBy,
    spentUsd,
  };
}
