/**
 * kangeiko/loop.ts — the verified self-improvement loop (dossier §2.1). NOT a new
 * agent: it sequences the dojo's subsystems through a Domain — MIDE(Kagami) →
 * INVESTIGA(Kagemusha) → FABRICA(Shugyō) → CERTIFICA(Sello) → CONSOLIDA → RE-MIDE.
 * Only CERTIFIED skills enter the repertoire (auto-mejora comprobada, no contada);
 * a candidate that fails the oracle is discarded, NOT counted. Budgets bound it.
 * Deterministic orchestration; the Domain phases are the live subsystems.
 */

import type { Domain, KangeikoBudget, KangeikoState, CurvePoint } from './types.js';
import { curveRising, curveDelta } from './curve.js';

export interface KangeikoResult { state: KangeikoState; rising: boolean; delta: number; }
export type Persist = (state: KangeikoState) => void;

const COST = { measure: 5, investigate: 10, fabricate: 10, certify: 5 };

/** Run the self-improvement loop over a domain until budget/cycles/no-gaps. */
export async function runKangeiko(domain: Domain, budget: KangeikoBudget, opts: { persist?: Persist } = {}): Promise<KangeikoResult> {
  const state: KangeikoState = { domain: domain.name, cycle: 0, curve: [], repertoire: [], discarded: [], tokensSpent: 0, status: 'running' };
  const persist = opts.persist ?? (() => {});

  while (state.cycle < budget.maxCycles && state.tokensSpent < budget.maxTokens) {
    state.cycle++;

    // MIDE — measure the frontier against the oracle bank.
    const { point, gaps } = await domain.measure();
    state.tokensSpent += COST.measure;
    state.curve.push({ cycle: state.cycle, passed: point.passed, total: point.total });
    persist(state);

    if (gaps.length === 0) { state.status = 'done'; break; }   // nothing left to improve here

    // Pull the most promising gaps first, under the per-cycle skill budget.
    const targets = [...gaps].sort((a, b) => b.priorScore - a.priorScore).slice(0, budget.maxSkillsPerCycle);
    for (const gap of targets) {
      if (state.tokensSpent >= budget.maxTokens) break;
      const knowledge = await domain.investigate(gap); state.tokensSpent += COST.investigate;
      const candidate = await domain.fabricate(knowledge); state.tokensSpent += COST.fabricate;
      const outcome = await domain.certify(candidate); state.tokensSpent += COST.certify;
      // CERTIFICA gate: ONLY certified skills enter the repertoire.
      if (outcome.certified) { if (!state.repertoire.includes(outcome.skill_id)) state.repertoire.push(outcome.skill_id); }
      else state.discarded.push(outcome.skill_id);
      persist(state);
    }

    // CONSOLIDA — fuse/prune the repertoire (no dump). The domain owns the policy.
    const { repertoireSize } = await domain.consolidate(state.repertoire);
    if (repertoireSize < state.repertoire.length) state.repertoire = state.repertoire.slice(0, repertoireSize);
    persist(state);
  }

  // RE-MIDE — a closing measurement captures the last cycle's improvement.
  if (state.status !== 'halted' && state.cycle > 0) {
    const { point } = await domain.measure();
    state.curve.push({ cycle: state.cycle + 1, passed: point.passed, total: point.total });
  }
  if (state.status === 'running') state.status = 'done';
  persist(state);

  return { state, rising: curveRising(state.curve), delta: curveDelta(state.curve) };
}

export type { CurvePoint };
