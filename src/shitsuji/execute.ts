/**
 * shitsuji/execute.ts — execution with the armor on (dossier §11/§12, ⚑). The
 * heart of the butler's safety over REAL data:
 *   - never runs an infeasible plan;
 *   - never runs a required-approval step that wasn't approved;
 *   - FALLO NO-CIEGO: on a step failure, STOP (no blind continue), revert the
 *     reversible/on_copy steps already done, report the real state;
 *   - NO FABRICAR (11.4): the summary never says "completed" if anything failed;
 *   - emits a chained TEV of declared-vs-observed effects.
 * The step runner + revert are injected (the live ⚑ part); the safety logic here
 * is deterministic and tested.
 */

import * as crypto from 'node:crypto';
import type { Plan, PlanStep, StepResult, PlanResult, TEVEntry } from './types.js';

export interface ExecuteDeps {
  runStep: (step: PlanStep) => Promise<StepResult>;     // live: execute the certified skill ⚑
  revert?: (step: PlanStep) => Promise<void>;           // undo a reversible/on_copy step
  approved: Set<string> | string[];
  ts: string;                                           // injected timestamp (reproducible)
}

function sha(s: string): string { return crypto.createHash('sha256').update(s).digest('hex').slice(0, 24); }

function tevEntry(step: PlanStep, r: StepResult, prev: string, ts: string): TEVEntry {
  const base = {
    step_id: step.step_id, skill_id: step.skill_id,
    declared_effects: [step.expected_effect], observed_effects: [r.real_effect],
    on_data: String((step.inputs as any).path ?? (step.inputs as any).target ?? 'n/a'),
    integrity_checks: [{ check: '11.2_within_effects', verdict: (r.status === 'ok' ? 'PASS' : 'FAIL') as 'PASS' | 'FAIL' }],
    timestamp: ts, prev_hash: prev,
  };
  return { ...base, this_hash: `sha256:${sha(prev + JSON.stringify(base))}` };
}

export async function runPlan(plan: Plan, deps: ExecuteDeps): Promise<PlanResult> {
  const approved = deps.approved instanceof Set ? deps.approved : new Set(deps.approved);
  const results: StepResult[] = [];
  const tev: TEVEntry[] = [];
  let prev = 'genesis';

  if (!plan.feasible) {
    return { plan_id: plan.plan_id, status: 'aborted', steps: [], honest_summary: `No ejecutado: plan no factible — faltan: ${plan.missing_skills.join(', ') || 'capacidades'}. No improviso sobre tus datos.` };
  }

  const completed: PlanStep[] = [];
  let failedAt: PlanStep | null = null;
  let blockedAt: PlanStep | null = null;

  for (const step of plan.steps) {
    if (step.requires_approval && !approved.has(step.step_id)) {
      blockedAt = step;
      results.push({ step_id: step.step_id, status: 'skipped', real_effect: 'no ejecutado: requiere aprobación no concedida' });
      break;                                            // ⚑ no irreversible/external sin sí explícito
    }
    const r = await deps.runStep(step);
    results.push(r);
    tev.push(tevEntry(step, r, prev, deps.ts)); prev = tev[tev.length - 1].this_hash;
    if (r.status === 'failed') { failedAt = step; break; }   // FALLO NO-CIEGO: parar
    completed.push(step);
  }

  // Revert the reversible/on_copy work already done (in reverse), where possible.
  if ((failedAt || blockedAt) && deps.revert) {
    for (let i = completed.length - 1; i >= 0; i--) {
      const s = completed[i];
      if (s.reversibility === 'reversible' || s.on_copy) {
        try { await deps.revert(s); const res = results.find((r) => r.step_id === s.step_id); if (res) { res.reverted = true; res.status = 'rolled_back'; } } catch { /* best effort */ }
      }
    }
  }
  // Mark steps never reached as skipped.
  for (const step of plan.steps) if (!results.some((r) => r.step_id === step.step_id)) results.push({ step_id: step.step_id, status: 'skipped', real_effect: 'no alcanzado' });

  const anyFailedOrBlocked = !!failedAt || !!blockedAt;
  // partial = something real STANDS (a non-reverted ok step); if all done work was
  // reverted (or nothing ran), the honest net state is 'aborted'.
  const anyStands = results.some((r) => r.status === 'ok');
  const status: PlanResult['status'] = !anyFailedOrBlocked ? 'completed' : anyStands ? 'partial' : 'aborted';

  return { plan_id: plan.plan_id, status, steps: results, honest_summary: summarize(status, results, failedAt, blockedAt), tev_ref: tev.length ? tev[tev.length - 1].this_hash : undefined, tev };
}

function summarize(status: PlanResult['status'], results: StepResult[], failedAt: PlanStep | null, blockedAt: PlanStep | null): string {
  const ok = results.filter((r) => r.status === 'ok').length;
  const reverted = results.filter((r) => r.status === 'rolled_back').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  if (status === 'completed') return `Hecho: ${ok} pasos completados y verificados.`;
  if (blockedAt) return `Parado en ${blockedAt.step_id}: requiere tu aprobación. ${ok} hechos, ${reverted} revertidos, ${skipped} sin tocar. NO está completado.`;
  return `Falló en ${failedAt?.step_id}. ${ok} pasos ok, ${reverted} revertidos, ${skipped} sin ejecutar. NO está completado — paré y no seguí a ciegas.`;
}

/** 11.4 guard on the response: "completed" requires EVERY step ok (no fabrication). */
export function assertNoFabrication(result: PlanResult): boolean {
  if (result.status === 'completed') return result.steps.every((s) => s.status === 'ok');
  // Not 'completed': the summary must not claim success. Strip the explicit "NO está
  // completado" disclaimer first so its own "completado" token doesn't trip the check.
  return !/(\bhecho\b|completad)/i.test(result.honest_summary.replace(/NO está completado/gi, ''));
}
