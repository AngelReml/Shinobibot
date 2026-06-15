/**
 * kagami/frontier/map.ts — the frontier map (dossier §7). The frontier is
 * MEASURED, not presumed: a cell's verdict comes from success_rate against an
 * oracle bank + calibration gap, never from a hunch. Knowing the exact frontier
 * is what enables boldness without recklessness. Pure.
 */

import type { CapabilityCell, FrontierVerdict } from '../types.js';

/** Classify a capability from its measured success_rate + declared confidence. */
export function classifyCapability(input: {
  capability_id: string; category: string; success_rate: number; sample_size: number;
  declared_confidence: number; source_bank: string; measured_at: string;
}): CapabilityCell {
  const success = clamp01(input.success_rate);
  const declared = clamp01(input.declared_confidence);
  const calibration_gap = Math.abs(declared - success);
  let verdict: FrontierVerdict;
  if (success < 0.4) verdict = 'BEYOND_FRONTIER';
  else if (success >= 0.8 && calibration_gap <= 0.15) verdict = 'RELIABLE';
  else verdict = 'SHAKY';
  return {
    capability_id: input.capability_id, category: input.category,
    success_rate: success, sample_size: input.sample_size,
    declared_confidence: declared, calibration_gap,
    measured_at: input.measured_at, source_bank: input.source_bank, verdict,
  };
}

/** A queryable, measured frontier map. A capability with no cell is "not measured", never "reliable". */
export class FrontierMap {
  private cells = new Map<string, CapabilityCell>();
  constructor(cells: CapabilityCell[] = []) { for (const c of cells) this.cells.set(c.capability_id, c); }
  set(c: CapabilityCell): void { this.cells.set(c.capability_id, c); }
  get(capabilityId: string): CapabilityCell | null { return this.cells.get(capabilityId) ?? null; }
  /** Verdict for a capability; UNMEASURED (not "reliable") when absent — fail-closed honesty. */
  verdictFor(capabilityId: string): FrontierVerdict | 'UNMEASURED' { return this.cells.get(capabilityId)?.verdict ?? 'UNMEASURED'; }
  summary(): { reliable: number; shaky: number; beyond: number } {
    let reliable = 0, shaky = 0, beyond = 0;
    for (const c of this.cells.values()) {
      if (c.verdict === 'RELIABLE') reliable++;
      else if (c.verdict === 'SHAKY') shaky++;
      else beyond++;
    }
    return { reliable, shaky, beyond };
  }
  all(): CapabilityCell[] { return [...this.cells.values()]; }
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }
