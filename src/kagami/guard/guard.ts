/**
 * kagami/guard/guard.ts — Pillar A sweep composition + trend (dossier §6.2).
 * The guard VIGILA y REPORTA (never self-modifies). It composes the crack
 * detectors + the runner results (suite/static/coverage — injected, since running
 * them is live) into a CodeHealthSnapshot. The trend turns "fortress" from
 * aspiration into a measurable fact: a fortress is proven by its map, not its name.
 * Deterministic.
 */

import type { CodeHealthSnapshot, Crack, ModuleHealth } from '../types.js';

export interface SweepInputs {
  snapshot_id: string;
  taken_at: string;
  suite: { passed: number; failed: number; skipped: number; duration_ms: number };
  typecheck_errors: number;
  lint_warnings: number;
  coverage_overall?: number;
  modules: ModuleHealth[];
  cracks: Crack[];
}

/** Assemble a CodeHealthSnapshot from the (injected) runner results + detected cracks. */
export function buildSnapshot(inp: SweepInputs): CodeHealthSnapshot {
  return {
    snapshot_id: inp.snapshot_id, taken_at: inp.taken_at, suite: inp.suite,
    typecheck_errors: inp.typecheck_errors, lint_warnings: inp.lint_warnings,
    coverage_overall: inp.coverage_overall, modules: inp.modules, cracks: inp.cracks,
  };
}

function severityWeight(c: Crack): number { return { low: 1, medium: 3, high: 8, critical: 20 }[c.severity]; }

/** Crack burden = severity-weighted sum (so a critical dominates many lows). */
export function crackBurden(s: CodeHealthSnapshot): number {
  return s.cracks.reduce((acc, c) => acc + severityWeight(c), 0);
}

/**
 * Health trend between two snapshots. 'up' = improving (less crack burden, more
 * coverage, no new test failures); 'down' = worse; 'flat' = neither clearly.
 */
export function healthTrend(prev: CodeHealthSnapshot | null, curr: CodeHealthSnapshot): 'up' | 'flat' | 'down' {
  if (!prev) return 'flat';
  const burdenDelta = crackBurden(curr) - crackBurden(prev);
  const failDelta = curr.suite.failed - prev.suite.failed;
  const covDelta = (curr.coverage_overall ?? 0) - (prev.coverage_overall ?? 0);
  // Regressions (new failures) or more crack burden dominate → down.
  if (failDelta > 0 || burdenDelta > 0) return 'down';
  if (burdenDelta < 0 || covDelta > 0.01 || failDelta < 0) return 'up';
  return 'flat';
}
