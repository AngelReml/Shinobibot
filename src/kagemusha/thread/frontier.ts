/**
 * kagemusha/thread/frontier.ts — frontier, pruning and budget (dossier §8.6).
 *
 * Pulling threads is recursive; without brakes it is infinite. The defence is a
 * PRIORITY QUEUE (pull the most promising thread first, so when budget runs out
 * what was investigated is the most valuable) + hard budgets + anti-cycle. Pruning
 * is part of the design, not a patch. Pure logic — no I/O, no LLM.
 */

import type { Entity, FrontierItem, MissionBudget, MissionState } from '../types.js';

/** Canonical key for an entity (anti-cycle + dedup). */
export function canonical(e: Entity): string {
  return `${e.kind}:${e.name.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

/** §8.6 — should this candidate be expanded into a new thread? All gates must pass. */
export function shouldExpand(item: FrontierItem, budget: MissionBudget, state: MissionState): boolean {
  if (item.parentDepth + 1 > budget.maxDepth) return false;
  if (state.threadsOpened >= budget.maxThreads) return false;
  if (state.tokensSpent >= budget.maxTokens) return false;
  if (item.priorScore < budget.minRelevance) return false;
  if (state.visited.includes(canonical(item.candidate))) return false; // anti-cycle
  return true;
}

/**
 * Priority queue over frontier items: highest priorScore first. A binary-heap
 * would scale better, but a sorted array is correct and clear for the thread
 * counts we run (≤ a few dozen). Stable enough; ties broken by lower depth.
 */
export class Frontier {
  private items: FrontierItem[] = [];

  constructor(seed: FrontierItem[] = []) { for (const i of seed) this.push(i); }

  push(item: FrontierItem): void {
    this.items.push(item);
    this.items.sort((a, b) => (b.priorScore - a.priorScore) || (a.parentDepth - b.parentDepth));
  }

  /** Pop the most promising candidate, or null when empty. */
  pop(): FrontierItem | null {
    return this.items.shift() ?? null;
  }

  get size(): number { return this.items.length; }
  snapshot(): FrontierItem[] { return [...this.items]; }
}

/**
 * Adjust a candidate's prior score from graph signals (§8.6): cited by a SOLID
 * source ↑, appears in several threads ↑, central in the graph ↑; high depth ↓,
 * similar nodes already exist ↓, low corpus relevance ↓. Bounded [0,1].
 */
export function adjustPriorScore(base: number, signals: {
  citedBySolid?: boolean; appearsInThreads?: number; centrality?: number;
  depth?: number; duplicateNearby?: boolean;
}): number {
  let s = base;
  if (signals.citedBySolid) s += 0.2;
  if (signals.appearsInThreads && signals.appearsInThreads > 1) s += Math.min(signals.appearsInThreads - 1, 3) * 0.05;
  if (signals.centrality) s += Math.min(signals.centrality, 1) * 0.1;
  if (signals.depth) s -= signals.depth * 0.08;
  if (signals.duplicateNearby) s -= 0.15;
  return Math.max(0, Math.min(1, s));
}
