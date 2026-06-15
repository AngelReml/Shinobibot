/**
 * shitsuji/adapters.ts — T-03: the ⚠ ENGANCHE seams to the rest of the dojo,
 * verified against the REAL module signatures (the GATE: they compile against the
 * real modules). The butler reuses, never reimplements:
 *
 *   - Shugyō repertoire (via Kangeiko's persisted curve store): the set of ACTIVE
 *     CERTIFIED skills it may compose. The butler is as capable as this set — no
 *     more, and it never improvises beyond it.
 *   - Chizu: the Atlas, for resolving "mi programa de X" → app_id (built from the
 *     AppCards Chizu produced).
 *   - Approval gate (src/security/approval.ts): granular per-step approval for
 *     irreversible/external steps (A1/A2).
 *   - Capa 2 (src/integrity): effect/fabrication enforcement — used directly in
 *     runtime.ts (check11_2/11_4); re-exported here as the documented seam.
 *
 * These are thin: each forwards to the real subsystem. No new capability is born
 * here — only the wiring.
 */

import { KangeikoStore } from '../kangeiko/store.js';
import { Atlas } from '../chizu/atlas/atlas.js';
import type { AppCard } from '../chizu/types.js';
import { requestApproval, type Asker } from '../security/approval.js';
import type { Plan, PlanStep } from './types.js';

// ── Capa 2 seam (re-export the real checks the executor enforces) ───────────────
export { effectWithin, classifyEffect, type Effect } from '../integrity/effects.js';
export { check11_2, check11_4 } from '../integrity/checks.js';

/**
 * ⚠ ENGANCHE Shugyō/Kangeiko: the ACTIVE certified repertoire. Shugyō has no store
 * of its own — the certified skills live in Kangeiko's repertoire table with
 * status 'active' (one per capability after consolidation). The butler composes
 * exactly this set.
 */
export function certifiedRepertoire(store?: KangeikoStore): Set<string> {
  const s = store ?? new KangeikoStore();
  const ids = s.listRepertoire('active').map((e) => e.skill_id);
  if (!store) s.close();
  return new Set(ids);
}

/** ⚠ ENGANCHE Chizu: build the Atlas the butler resolves references against. */
export function atlasFromCards(cards: AppCard[]): Atlas {
  return new Atlas(cards);
}

/**
 * ⚠ ENGANCHE approval gate: ask for one step's approval. Reversible steps proceed
 * without friction; irreversible/external steps are routed to requestApproval as
 * 'destructive' so the selective brake fires (A1/A2). Returns true to proceed.
 */
export async function requestStepApproval(step: PlanStep, asker?: Asker): Promise<boolean> {
  // external_effect is documented-not-fired by the executor regardless; still gate it.
  if (!step.requires_approval) return true;
  return requestApproval({
    toolName: step.skill_id ?? step.capability ?? `step:${step.step_id}`,
    args: step.inputs,
    destructive: true,
    reason: `${step.expected_effect} [${step.reversibility}]`,
  });
}

/** Convenience: which steps of a plan still need an explicit yes (mirrors approval.ts). */
export function planNeedsApproval(plan: Plan): boolean {
  return plan.steps.some((s) => s.requires_approval);
}
