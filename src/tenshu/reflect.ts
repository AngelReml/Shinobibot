/**
 * tenshu/reflect.ts — "REFLEJA, NO NARRA" (dossier §3.5/§5, TS-08). THE soul of the
 * bridge. The panel shows VERIFIABLE facts from the store/TEV, never a narration
 * the LLM invents. Every panel claim must be clickable down to its evidence; a
 * claim without a backing event/trace is narration → flagged. This is Capa 2 check
 * 11.4 applied to the control panel: what the Tenshu says Shinobi did must match
 * what the events/TEV record it did. Pure.
 */

import type { SystemEvent } from './types.js';

export interface PanelClaim { text: string; trace_ref?: string; event_id?: string; }

export interface ReflectResult { ok: boolean; backed: PanelClaim[]; unbacked: PanelClaim[]; }

/**
 * A claim is BACKED iff it points (by event_id or trace_ref) to an event/trace
 * that actually exists in the recorded history. Unbacked claims are narration and
 * are flagged out — never shown as fact.
 */
export function reflect(claims: PanelClaim[], events: SystemEvent[]): ReflectResult {
  const ids = new Set(events.map((e) => e.event_id));
  const traces = new Set(events.map((e) => e.trace_ref).filter(Boolean) as string[]);
  const backed: PanelClaim[] = [], unbacked: PanelClaim[] = [];
  for (const c of claims) {
    const ok = (!!c.event_id && ids.has(c.event_id)) || (!!c.trace_ref && traces.has(c.trace_ref));
    (ok ? backed : unbacked).push(c);
  }
  return { ok: unbacked.length === 0, backed, unbacked };
}

/** Strict gate: throw if the panel would narrate anything unbacked (§5 P5). */
export function assertReflected(claims: PanelClaim[], events: SystemEvent[]): PanelClaim[] {
  const r = reflect(claims, events);
  if (!r.ok) throw new Error(`tenshu: panel would narrate ${r.unbacked.length} unbacked claim(s) — refleja, no narra`);
  return r.backed;
}
