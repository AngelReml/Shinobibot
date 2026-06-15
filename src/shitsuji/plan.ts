/**
 * shitsuji/plan.ts — Intent → Plan (dossier §8). Maps each goal to a CERTIFIED
 * skill (or a dojo capability), wires the cross-app data_flow, and annotates risk
 * + reversibility. The plan is an inspectable artifact shown before any real
 * effect. Pure (the goal→skill mapping is provided by the planner/Kagami).
 */

import type { Plan, PlanStep, DataEdge, StepReversibility } from './types.js';

export interface StepSpec {
  goal_id: string;
  skill_id?: string;
  capability?: 'kagemusha' | 'chizu_lookup';
  inputs?: Record<string, unknown>;
  expected_effect: string;
  reversibility: StepReversibility;
  on_copy?: boolean;
}

/** Build a plan from mapped step specs + a data flow. requires_approval is derived
 *  from reversibility: anything not plainly reversible needs the user's yes (⚑). */
export function buildPlan(intentId: string, planId: string, specs: StepSpec[], dataFlow: DataEdge[] = []): Plan {
  const steps: PlanStep[] = specs.map((s, i) => ({
    step_id: `s${i + 1}`,
    goal_id: s.goal_id,
    skill_id: s.skill_id,
    capability: s.capability,
    inputs: s.inputs ?? {},
    expected_effect: s.expected_effect,
    reversibility: s.reversibility,
    on_copy: s.on_copy ?? (s.reversibility !== 'reversible'),   // value-data → prefer a copy
    requires_approval: s.reversibility !== 'reversible',
  }));
  const risk_summary = {
    irreversible_steps: steps.filter((s) => s.reversibility === 'irreversible').length,
    external_effect_steps: steps.filter((s) => s.reversibility === 'external_effect').length,
  };
  return { plan_id: planId, intent_id: intentId, steps, data_flow: dataFlow, feasible: false, missing_skills: [], risk_summary };
}

/** Render the plan in plain language (shown to the user before any real effect). */
export function renderPlan(plan: Plan): string {
  const L = [`Plan ${plan.plan_id} (${plan.steps.length} pasos):`];
  for (const s of plan.steps) {
    const tags = [s.reversibility, s.on_copy ? 'sobre copia' : null, s.requires_approval ? 'requiere aprobación' : null].filter(Boolean).join(', ');
    L.push(`  ${s.step_id}. ${s.expected_effect}  [${tags}]${s.skill_id ? ` (skill ${s.skill_id})` : s.capability ? ` (${s.capability})` : ''}`);
  }
  if (plan.risk_summary.irreversible_steps || plan.risk_summary.external_effect_steps) {
    L.push(`  ⚑ ${plan.risk_summary.irreversible_steps} irreversible(s), ${plan.risk_summary.external_effect_steps} de efecto externo — pediré aprobación.`);
  }
  return L.join('\n');
}
