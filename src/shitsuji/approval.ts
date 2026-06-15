/**
 * shitsuji/approval.ts — granular approval for real effects (dossier §10, ⚑).
 * Reversible steps run without friction; irreversible/external steps need an
 * explicit yes. Approval is per-session, not forever. Pure policy; the actual
 * prompt is the existing approval gate surface.
 */

import type { Plan } from './types.js';

/** Step ids that need the user's explicit approval before running. */
export function approvalsNeeded(plan: Plan): string[] {
  return plan.steps.filter((s) => s.requires_approval).map((s) => s.step_id);
}

/** Which required-approval steps are still NOT approved (would block execution). */
export function unapproved(plan: Plan, approved: Set<string> | string[]): string[] {
  const ok = approved instanceof Set ? approved : new Set(approved);
  return approvalsNeeded(plan).filter((id) => !ok.has(id));
}
