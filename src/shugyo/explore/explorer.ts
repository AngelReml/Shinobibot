/**
 * shugyo/explore/explorer.ts — active exploration (dossier §9). The explorer
 * probes affordances and observes effects in the revertible cage, under budget,
 * building the material the model is induced from. Reversibility is classified
 * BEFORE acting; external_effect is never fired; everything reverts. The order is
 * a priority queue by exploration value (safe-to-probe first), so when budget runs
 * out, what was explored is the most useful. Deterministic core (the swarm just
 * fans this over several cages — §9.1 E3).
 */

import type { Affordance, ActionTrial } from '../types.js';
import { DirCageSandbox, runTrial } from '../sandbox/revertible.js';
import { executionPolicy } from './reversibility.js';

export interface ExploreBudget { maxActions: number; }

/** Exploration value: safe-to-probe reversible first; external_effect lowest (documented only). */
function value(a: Affordance): number {
  switch (executionPolicy(a.reversibility)) {
    case 'probe': return 3;        // reversible
    case 'filler_only': return a.reversibility === 'destructive' ? 2 : 1; // destructive > unknown
    case 'document_only': return 0; // external_effect — only documented
  }
}

/** Order affordances by exploration value (priority queue, descending). */
export function orderByValue(affordances: Affordance[]): Affordance[] {
  return [...affordances].sort((a, b) => value(b) - value(a));
}

/**
 * Probe a surface within budget. Each affordance becomes an ActionTrial via the
 * revertible cage (snapshot→run→observe→revert). external_effect affordances yield
 * a "not fired" trial. Returns the trials + how many actions were spent.
 */
export async function explore(
  affordances: Affordance[], cage: DirCageSandbox, budget: ExploreBudget,
): Promise<{ trials: ActionTrial[]; actionsSpent: number; externalDocumented: number }> {
  const ordered = orderByValue(affordances);
  const trials: ActionTrial[] = [];
  let spent = 0, externalDocumented = 0;
  for (const a of ordered) {
    if (spent >= budget.maxActions) break;
    const trial = await runTrial(cage, a);
    trials.push(trial);
    spent++;
    if (a.reversibility === 'external_effect') externalDocumented++;
  }
  return { trials, actionsSpent: spent, externalDocumented };
}
