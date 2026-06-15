/**
 * shitsuji/orchestrate.ts — the butler's conductor: the full pipeline that turns a
 * natural-language order into act, tying together the pieces of the dojo (dossier
 * §5 flow). It is the glue, deterministic; every live capability is injected.
 *
 *   COMPRENDER → PLANIFICAR → ¿FACTIBLE? → APROBAR → EJECUTAR → VERIFICAR → TRAZA
 *
 * The safety border is phase 4→5 (dossier §5): phases 1–3 are reasoning WITHOUT
 * effects (safe); only an approved, feasible plan reaches real execution. So:
 *   - if the intent isn't ready (ambiguous reference on real data) → it ASKS, stops.
 *   - if the plan isn't feasible (a step outside the certified repertoire) → it
 *     DECLINES precisely, stops — never improvises on real data.
 *   - otherwise it executes under the armor (runtime.ts) and returns the honest
 *     result + the step-by-step verifiable trace ("déjame ver qué hiciste").
 */

import { comprehend, intentReady, pendingQuestions, type IntentParser, type ReferenceResolvers } from './understand.js';
import { buildPlan, renderPlan, type StepSpec } from './plan.js';
import { checkFeasibility, type FeasibilityResult } from './feasibility.js';
import { approvalsNeeded } from './approval.js';
import { runPlan, type ExecuteDeps } from './execute.js';
import type { ShitsujiStore } from './store.js';
import type { Intent, Plan, PlanResult, DataEdge } from './types.js';

export interface ServeDeps {
  parse: IntentParser;                                              // ⚑ LLM: utterance → goals + references
  resolvers?: ReferenceResolvers;                                   // Chizu / filesystem / context
  repertoire: Set<string> | string[];                              // ACTIVE certified skills (adapters.certifiedRepertoire)
  plan: (intent: Intent) => { specs: StepSpec[]; dataFlow?: DataEdge[] };  // ⚑ goal→skill mapping (planner/Kagami)
  executor?: ExecuteDeps;                                           // ⚑ live executor (makeRealExecutor); absent ⇒ plan-only (dry)
  store?: ShitsujiStore;                                            // persist intent/plan/result/TEV
  ts: string;
  ids?: { intent?: string; plan?: string };
}

export type ServeOutcome = 'asked' | 'declined' | 'planned' | 'executed';

export interface ServeResult {
  outcome: ServeOutcome;
  intent: Intent;
  pending_questions: string[];
  plan?: Plan;
  feasibility?: FeasibilityResult;
  approvals_needed: string[];
  result?: PlanResult;
  narration: string;                 // the step-by-step the user reads
}

export async function serve(utterance: string, deps: ServeDeps): Promise<ServeResult> {
  const intentId = deps.ids?.intent ?? 'intent_1';
  const planId = deps.ids?.plan ?? 'plan_1';

  // 1. COMPRENDER (reasoning, no effects)
  const intent = await comprehend(intentId, utterance, deps.parse, deps.resolvers);
  deps.store?.saveIntent(intent, deps.ts);
  const N: string[] = [comprehendLine(intent)];

  if (!intentReady(intent)) {
    const qs = pendingQuestions(intent);
    N.push(`PREGUNTO (no adivino sobre tus datos): ${qs.join(' · ')}`);
    return { outcome: 'asked', intent, pending_questions: qs, approvals_needed: [], narration: N.join('\n') };
  }

  // 2. PLANIFICAR (reasoning, no effects)
  const { specs, dataFlow } = deps.plan(intent);
  const plan = buildPlan(intentId, planId, specs, dataFlow);
  N.push('PLANIFICAR:', renderPlan(plan));

  // 3. ¿FACTIBLE? (the honest border)
  const feasibility = checkFeasibility(plan, deps.repertoire);
  deps.store?.savePlan(plan, deps.ts);
  if (!feasibility.feasible) {
    N.push(`DECLINO: ${feasibility.decline_message}`);
    return { outcome: 'declined', intent, pending_questions: [], plan, feasibility, approvals_needed: [], narration: N.join('\n') };
  }
  N.push('FACTIBLE: sí — todos los pasos están en mi repertorio CERTIFIED.');

  // 4. APROBAR (surface what needs an explicit yes)
  const approvals_needed = approvalsNeeded(plan);
  N.push(approvals_needed.length ? `APROBAR: estos pasos requieren tu sí (⚑): ${approvals_needed.join(', ')}` : 'APROBAR: ningún paso irreversible/externo.');

  // 5–6. EJECUTAR + VERIFICAR (⚑ real effects) — only with a live executor.
  if (!deps.executor) {
    N.push('EJECUTAR: (dry-run, sin executor vivo) — plan listo, no se tocó nada.');
    return { outcome: 'planned', intent, pending_questions: [], plan, feasibility, approvals_needed, narration: N.join('\n') };
  }
  const result = await runPlan(plan, deps.executor);
  deps.store?.saveResult(result, deps.ts);
  if (result.tev?.length) deps.store?.appendTev(planId, result.tev, deps.ts);
  N.push(`VERIFICAR: ${result.honest_summary}`);

  // 7. TRAZA ("déjame ver qué hiciste, paso por paso")
  N.push('TRAZA (paso por paso):');
  for (const s of result.steps) N.push(`  ${s.step_id}: ${s.status} — ${s.real_effect}`);
  if (result.tev_ref) N.push(`  TEV: ${result.tev?.length ?? 0} eslabones, cabeza ${result.tev_ref}`);

  return { outcome: 'executed', intent, pending_questions: [], plan, feasibility, approvals_needed, result, narration: N.join('\n') };
}

function comprehendLine(intent: Intent): string {
  const refs = intent.references.map((r) => `"${r.phrase}"→${r.resolved_to || '?'} (${r.method}, conf ${r.confidence.toFixed(2)})`).join('; ');
  return `COMPRENDER: ${intent.goals.length} objetivo(s)${refs ? `; referencias: ${refs}` : ''}.`;
}
