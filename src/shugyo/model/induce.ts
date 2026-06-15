/**
 * shugyo/model/induce.ts — induce the operational model (dossier §10, ◆ the hard
 * phase). From ActionTrial[] to capabilities with procedure + success_check +
 * grade. The model is a HYPOTHESIS, not the program's truth — it carries
 * confidence and grade, and NOTHING is used until certified (§11). Where induction
 * is ◆ (UI/canvas) the model is partial and DECLARED as such: dominating part of a
 * program, knowing which, is honest and useful; faking the whole is the mirage we
 * avoid. Deterministic grouping core.
 */

import type { ActionTrial, Affordance, Capability, Grade, OperationalModel, Via } from '../types.js';

function gradeForVia(via: Via): Grade {
  return via === 'cli' || via === 'com' ? 'strong' : via === 'uia' ? 'medium' : 'experimental';
}

function effectsForReversibility(rev: Affordance['reversibility']): string[] {
  switch (rev) {
    case 'reversible': return ['reads_or_produces_output'];
    case 'destructive': return ['modifies_or_deletes_files'];
    case 'external_effect': return ['external_side_effect'];
    default: return ['unknown_effect'];
  }
}

/**
 * Group trials that produced a coherent observable effect into capabilities, one
 * per affordance that actually did something. external_effect affordances (never
 * fired) do NOT become capabilities — they're documented, not learned.
 */
export function induceModel(trials: ActionTrial[], affordances: Affordance[], app_id: string, via: Via): OperationalModel {
  const byId = new Map(affordances.map((a) => [a.affordance_id, a]));
  const capabilities: Capability[] = [];
  let executed = 0, effective = 0;

  for (const t of trials) {
    const aff = byId.get(t.affordance_id);
    if (!aff) continue;
    const fired = t.observed_effect && !/not fired/i.test(t.observed_effect);
    if (fired) executed++;
    const changed = t.state_before.ref !== t.state_after.ref;
    if (!fired || !changed || !t.success) continue; // only coherent, executed, effectful trials
    effective++;
    capabilities.push({
      capability_id: `${app_id}.${aff.label.replace(/[^\w]+/g, '_').toLowerCase()}`,
      description: `does: ${aff.label}`,
      procedure: [{ affordance_id: aff.affordance_id, args: t.args }],
      preconditions: [],
      success_check: `state change observed (${t.state_before.summary} → ${t.state_after.summary})`,
      effects: effectsForReversibility(aff.reversibility),
      grade: gradeForVia(via),
    });
  }

  // confidence = fraction of executed trials that yielded a coherent capability.
  const confidence = executed === 0 ? 0 : effective / executed;
  return { app_id, capabilities: dedupById(capabilities), confidence };
}

function dedupById(caps: Capability[]): Capability[] {
  const seen = new Set<string>();
  return caps.filter((c) => { if (seen.has(c.capability_id)) return false; seen.add(c.capability_id); return true; });
}
