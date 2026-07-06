// Tope de gasto del ciclo nocturno — $10/noche por defecto, FAIL-CLOSED.
//
// Reutiliza el patrón budgetUsd/spentUsd/budgetExceeded ya probado en
// swarm_orchestrator.ts (agents/swarm_plan.ts::budgetExceeded), no lo reinventa.
// La diferencia real con ese patrón: allí `budgetUsd<=0` significa "sin límite"
// (fail-OPEN si no hay techo configurado). Aquí el techo SIEMPRE es positivo
// (10 por defecto) y, sobre todo, si el gasto acumulado no se puede MEDIR
// (undefined/null/NaN — telemetría de coste caída o no cableada), la regla es
// PARAR, no asumir coste cero y seguir gastando sin control.

import { budgetExceeded } from '../agents/swarm_plan.js';

export const NIGHT_BUDGET_USD_DEFAULT = 10;

/** Techo de gasto nocturno: `SHINOBI_NIGHT_BUDGET_USD` si es un número > 0, si no el default. */
export function nightlyBudgetUsd(): number {
  const v = Number(process.env.SHINOBI_NIGHT_BUDGET_USD);
  return Number.isFinite(v) && v > 0 ? v : NIGHT_BUDGET_USD_DEFAULT;
}

/**
 * Fail-closed: `spentUsd` no medible (null/undefined/NaN/Infinity) ⇒ EXCEDIDO,
 * para de inmediato. Si es medible, delega en `budgetExceeded` (mismo criterio
 * ya usado por el enjambre): excedido si `spentUsd >= budgetUsd`.
 */
export function nightBudgetExceeded(
  spentUsd: number | null | undefined,
  budgetUsd: number = nightlyBudgetUsd(),
): boolean {
  if (spentUsd == null || !Number.isFinite(spentUsd)) return true;
  return budgetExceeded(spentUsd, budgetUsd);
}
