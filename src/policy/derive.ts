// P4 — derivación del mandato MÍNIMO por misión desde efectos observados.
//
// El hueco que mandate.ts declaraba abierto: «P4 lo sustituirá por derivación del
// mínimo por misión». Hoy el operador fija las capacidades a mano (SHINOBI_MANDATE)
// o vía policy. Esta capa cierra el lazo de least-privilege AUTOMÁTICO: se corre la
// misión en sombra (dry-run / observación, sin enforcement), se recogen los efectos
// REALES, y de ahí se DERIVA el mandato más ajustado que los habría permitido —
// listo para que el operador lo ADOPTE (adopción = human-gated, aquí solo se PROPONE).
//
// Least-privilege honesto (no el más corto a toda costa):
//   - Capacidades = scopes EXACTOS observados, deduplicados. Nunca un comodín, nunca
//     un padre NO observado: colapsar `/ws/a` y `/ws/b` en `/ws` concedería `/ws/c`
//     que jamás se tocó. Eso sería MÁS privilegio, no menos.
//   - Sí se retira un descendiente cuando un ANCESTRO también observado ya lo cubre
//     (`/ws` observado ⇒ `/ws/sub` es redundante: `/ws` ya lo concede por `scopeCovers`).
//     Antichain bajo la MISMA álgebra de cobertura (`mandateCovers`) — una sola fuente
//     de verdad, sin gramática divergente.
// Resultado: cobertura garantizada de todo lo observado, cero autoridad no observada,
// y minimalidad real (quitar cualquier capacidad deja algún efecto sin cubrir). Puro.

import type { Mandate, ExecutedEffect } from '../sandbox/mandate.js';
import { mandateCovers } from '../sandbox/mandate.js';
import type { SimEffect } from './dryrun.js';

/** Una capacidad cruda `(kind, scope)` antes de serializar a `"kind:scope"`. */
interface Cap { readonly kind: string; readonly scope: string; }

function capCovers(grant: Cap, need: Cap): boolean {
  return mandateCovers({ capabilities: [`${grant.kind}:${grant.scope}`] }, need.kind, need.scope);
}

/**
 * Deriva el `Mandate` mínimo que cubre EXACTAMENTE los efectos observados. Puro
 * (`now` inyectable). Efectos con `kind` vacío se ignoran (malformados). `ttlMs>0`
 * fija caducidad. Vacío ⇒ mandato sin capacidades (deny-all, fail-closed).
 */
export function deriveMandateFromEffects(
  effects: readonly SimEffect[],
  opts: { ttlMs?: number; now?: number } = {},
): Mandate {
  // 1) distintos exactos (dedup por kind+scope). Espacio como separador: kind no lo tiene.
  const distinct: Cap[] = [
    ...new Set(effects.filter((e) => !!e.kind).map((e) => `${e.kind} ${e.scope}`)),
  ].map((s) => {
    const i = s.indexOf(' ');
    return { kind: s.slice(0, i), scope: s.slice(i + 1) };
  });
  // 2) antichain: conserva una capacidad solo si NINGUNA OTRA distinta la cubre.
  const minimal = distinct.filter(
    (c) => !distinct.some((o) => (o.kind !== c.kind || o.scope !== c.scope) && capCovers(o, c)),
  );
  const capabilities = minimal.map((c) => `${c.kind}:${c.scope}`).sort();
  const now = opts.now ?? Date.now();
  const expiresAt =
    opts.ttlMs !== undefined && Number.isFinite(opts.ttlMs) && opts.ttlMs > 0 ? now + opts.ttlMs : undefined;
  return { capabilities, expiresAt };
}

/**
 * Puente para el auto-derive tras una misión REAL: toma los efectos que el monitor
 * recogió (`ExecutedEffect[]` de `currentMissionEffects`), descarta los DENEGADOS (no
 * ocurrieron) y deriva el mandato mínimo de los PERMITIDOS. Es la «propuesta de
 * least-privilege» que una misión emite sobre sí misma: «se te concedió M, pero solo
 * necesitabas M'». Proponer ≠ adoptar (adopción = human-gated). Puro.
 */
export function proposeMandateFromExecuted(
  effects: readonly ExecutedEffect[],
  opts: { ttlMs?: number; now?: number } = {},
): Mandate {
  return deriveMandateFromEffects(effects.filter((e) => e.decision === 'allow'), opts);
}

/** ¿El mandato cubre TODOS los efectos observados? Chequeo de sanidad (puro). */
export function mandateCoversAll(mandate: Mandate, effects: readonly SimEffect[]): boolean {
  return effects.every((e) => mandateCovers(mandate, e.kind, e.scope));
}
