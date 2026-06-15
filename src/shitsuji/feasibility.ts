/**
 * shitsuji/feasibility.ts — honesty before the act (dossier §9). Before touching
 * anything real, can the butler do the WHOLE plan? A step is covered iff its skill
 * is CERTIFIED in the repertoire (or it's a dojo capability). If a piece is
 * missing, the butler declines PRECISELY — it never improvises on real data. This
 * is Kagami's frontier applied to service. Pure.
 */

import type { Plan } from './types.js';

const DOJO_CAPABILITIES = new Set(['kagemusha', 'chizu_lookup']);

export interface FeasibilityResult { feasible: boolean; missing_skills: string[]; decline_message?: string; }

/** Check a plan against the certified repertoire. Fills feasible + missing_skills. */
export function checkFeasibility(plan: Plan, certifiedRepertoire: Set<string> | string[]): FeasibilityResult {
  const rep = certifiedRepertoire instanceof Set ? certifiedRepertoire : new Set(certifiedRepertoire);
  const missing: string[] = [];
  for (const step of plan.steps) {
    if (step.capability && DOJO_CAPABILITIES.has(step.capability)) continue;   // dojo capability — available
    if (step.skill_id && rep.has(step.skill_id)) continue;                     // certified skill — available
    missing.push(step.skill_id ?? `(${step.goal_id}: sin skill)`);             // not covered
  }
  const feasible = missing.length === 0;
  plan.feasible = feasible;
  plan.missing_skills = missing;
  const decline_message = feasible ? undefined
    : `Puedo hacer el resto, pero esto no lo domino aún: ${missing.join(', ')}. ¿Lo aprendo primero (Shugyō), o lo dejamos ahí? No lo voy a improvisar sobre tus datos.`;
  return { feasible, missing_skills: missing, decline_message };
}
