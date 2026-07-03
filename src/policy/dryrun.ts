// P4 — dry-run "what-if": simula una misión contra la policy SIN efectos reales.
//
// Convierte la policy de "reglas invisibles que saltan en runtime" en "un contrato que
// el operador puede inspeccionar y probar ANTES de ejecutar". Reusa la cobertura real
// (`mandateCovers`) y la resolución de mandato (`resolveMandate`): lo que el dry-run
// dice es exactamente lo que el monitor haría.

import type { Mandate } from '../sandbox/mandate.js';
import { mandateCovers } from '../sandbox/mandate.js';
import { resolveMandate, type Policy } from './engine.js';

export interface SimEffect { readonly kind: string; readonly scope: string; }
export interface SimDecision { readonly kind: string; readonly scope: string; readonly allowed: boolean; }
export interface Simulation { readonly mandate: Mandate; readonly decisions: SimDecision[]; readonly allAllowed: boolean; }

/** Simula qué efectos permitiría/denegaría la policy para una misión, sin ejecutar nada. */
export function simulateMission(
  policy: Policy,
  ctx: { profile?: string },
  effects: readonly SimEffect[],
  now?: number,
): Simulation {
  const mandate = resolveMandate(policy, ctx, now);
  const decisions = effects.map((e) => ({ kind: e.kind, scope: e.scope, allowed: mandateCovers(mandate, e.kind, e.scope) }));
  return { mandate, decisions, allAllowed: decisions.every((d) => d.allowed) };
}
