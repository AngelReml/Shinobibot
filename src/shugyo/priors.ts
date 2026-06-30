/**
 * shugyo/priors.ts — E7: ajuste de skill-priors por resultado de certificación.
 *
 * Cierra el circuito Shugyo→Sello→PatternBook:
 *   1. Shugyo usa PatternBook para seed la exploración (patrón → hints de procedimiento).
 *   2. Sello certifica (o descarta) la skill resultante.
 *   3. Este módulo propaga el resultado de Sello de vuelta al PatternBook,
 *      ajustando el hit_rate del patrón que produjo el intento.
 *
 * Sin este paso, PatternBook acumula patrones pero no aprende de los resultados:
 * el prior de un patrón que produce skills certificadas no sube, y el de uno que
 * produce skills descartadas no baja. Con este paso, el corpus mejora solo.
 *
 * El ajuste es deliberadamente suave (ver PRIORS_WEIGHT): una sola certificación
 * no colapsa el prior — se necesitan varias observaciones para que un patrón suba
 * a > 0.8 o baje a < 0.2. Esto evita el ruido de un solo caso raro.
 */

import type { PatternBook } from './curve/patternbook.js';
import type { CertResult } from './synth/certify.js';

export interface PriorAdjustmentRecord {
  idiom: string;
  outcome: 'certified' | 'discarded';
  hitRateBefore: number;
  hitRateAfter: number;
  timestamp: string;
}

/**
 * Ajusta el prior del patrón `idiom` en `patternBook` según el resultado de
 * la certificación. Devuelve un registro de la actualización para trazabilidad.
 *
 * Si el idiom no existe en el PatternBook (patrón no encontrado), devuelve null
 * — el ajuste no es posible sin un patrón de referencia.
 */
export function adjustPrior(
  patternBook: PatternBook,
  idiom: string,
  certResult: CertResult,
): PriorAdjustmentRecord | null {
  const before = patternBook.get(idiom);
  if (!before) return null;

  // Capturar el valor antes de la mutación: recordOutcome modifica el objeto in-place.
  const hitRateBefore = before.hit_rate;
  const accelerated = certResult.status === 'certified';
  patternBook.recordOutcome(idiom, accelerated);
  const hitRateAfter = patternBook.get(idiom)?.hit_rate ?? hitRateBefore;

  return {
    idiom,
    outcome: certResult.status,
    hitRateBefore,
    hitRateAfter,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Ajusta los priors de un conjunto de (idiom, certResult) pares.
 * Conveniente para batch-updates tras un ciclo de Kangeiko.
 *
 * Devuelve solo los registros donde el patrón existía (idioms desconocidos
 * se ignoran silenciosamente — son skills que no derivaron de un patrón).
 */
export function adjustPriors(
  patternBook: PatternBook,
  outcomes: { idiom: string; certResult: CertResult }[],
): PriorAdjustmentRecord[] {
  const records: PriorAdjustmentRecord[] = [];
  for (const { idiom, certResult } of outcomes) {
    const r = adjustPrior(patternBook, idiom, certResult);
    if (r) records.push(r);
  }
  return records;
}

/**
 * Devuelve el prior de certificación estimado para un idiom.
 * Si el patrón no se conoce (hit_rate=0 sin observaciones) → 0.5 (prior neutral).
 * Si hay muchas observaciones y hit_rate > 0.8 → el patrón es muy útil.
 * Si hit_rate < 0.2 y ha sido visto en ≥3 apps → patrón poco transferible.
 */
export function estimateCertPrior(patternBook: PatternBook, idiom: string): number {
  const p = patternBook.get(idiom);
  if (!p) return 0.5; // desconocido → prior neutral
  // Con pocas observaciones, moderar hacia 0.5 (regresión bayesiana ligera).
  const observations = p.seen_in.length;
  if (observations < 3) return 0.5 + (p.hit_rate - 0.5) * (observations / 3);
  return p.hit_rate;
}
