// src/agents/best_of_n_select.ts
//
// MOTOR E5 — NÚCLEO DE SELECCIÓN DE TEST-TIME COMPUTE (best-of-N reranking).
//
// La pieza que cierra la brecha de pass@1 en benchmarks públicos SIN cambiar de
// modelo: en vez de una sola pasada, se generan N candidatos diversos y un
// reranker los ordena por una política DETERMINISTA y TOTAL. El mejor se entrega.
//
// Por qué es la palanca correcta: en SWE-bench/GAIA/τ-bench la diferencia entre
// el mismo modelo "a una pasada" y "con selección" es de decenas de puntos. No
// es IQ del modelo; es scaffolding del harness. Y shinobi ya tiene el reranker
// (el verificador adversarial + los checks objetivos) — esto solo lo aprovecha.
//
// Este módulo es PURO (cero imports en runtime): la política de orden es
// testeable de forma determinista y aislada, y su orden es TOTAL (sin empates
// no resueltos) para que la elección sea reproducible bit a bit — propiedad que
// alimenta el claim de reproducibilidad del paquete de provenance.

/** Un candidato ya puntuado por las compuertas de verificación. */
export interface ScoredCandidate {
  /** Índice de generación (0..N-1), estable para desempate. */
  index: number;
  /** Salida final del candidato. */
  output: string;
  /** El rollout CERRÓ (sin error de infraestructura ni bucle abortado). */
  ok: boolean;
  /**
   * Compuerta OBJETIVA (tests/typecheck/lint): true=pasó, false=falló,
   * undefined=no se aplicó. El orden trata "no aplicada" como neutral, nunca
   * por encima de una que pasó de verdad.
   */
  objectivePassed?: boolean;
  /** El verificador adversarial aprobó la salida. */
  verifierPassed: boolean;
  /** Confianza/calidad del verificador 0..1. */
  score: number;
  /** Nº de iteraciones que consumió (menor = más limpio/barato, desempate). */
  iterations: number;
  /** Bucles abortados por el loop-detector durante el rollout (penaliza). */
  loopAborts?: number;
}

export interface Selection {
  /** Índice del candidato elegido. */
  chosenIndex: number;
  chosen: ScoredCandidate;
  /** Orden completo, del mejor al peor (índices). */
  ranking: number[];
  /** Justificación legible de por qué ganó. */
  rationale: string;
}

/**
 * Clave de orden TOTAL y DETERMINISTA. Tiers duros primero, luego continuo,
 * luego desempates por coste y por índice (estable). Mayor tupla = mejor.
 *
 * Prioridad:
 *   1. objetivo: pasó (2) > no aplicado (1) > falló (0)   — un gate de código
 *      no se puede revocar por un score alto del LLM.
 *   2. cerró el rollout (ok): sí (1) > no (0).
 *   3. verificador aprobó: sí (1) > no (0).
 *   4. score del verificador (0..1), continuo.
 *   5. menos bucles abortados (negado).
 *   6. menos iteraciones (negado) — más limpio/barato.
 *   7. menor índice (negado) — estable y reproducible.
 */
export function rankKey(c: ScoredCandidate): number[] {
  const objTier = c.objectivePassed === true ? 2 : c.objectivePassed === false ? 0 : 1;
  return [
    objTier,
    c.ok ? 1 : 0,
    c.verifierPassed ? 1 : 0,
    clamp01(c.score),
    -(c.loopAborts ?? 0),
    -Math.max(0, c.iterations | 0),
    -Math.max(0, c.index | 0),
  ];
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Compara dos claves lexicográficamente (mayor primero). */
function cmpKey(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return bv - av; // descendente
  }
  return 0;
}

/**
 * Selecciona el mejor candidato según la política de orden total. No lanza con
 * lista vacía: devuelve una selección vacía señalizada (chosenIndex=-1).
 */
export function selectBest(cands: ScoredCandidate[]): Selection {
  if (!cands || cands.length === 0) {
    return {
      chosenIndex: -1,
      chosen: { index: -1, output: '', ok: false, verifierPassed: false, score: 0, iterations: 0 },
      ranking: [],
      rationale: 'sin candidatos',
    };
  }
  const keyed = cands.map((c) => ({ c, k: rankKey(c) }));
  keyed.sort((x, y) => cmpKey(x.k, y.k));
  const ranking = keyed.map((x) => x.c.index);
  const chosen = keyed[0].c;
  return {
    chosenIndex: chosen.index,
    chosen,
    ranking,
    rationale: explain(chosen, cands.length),
  };
}

function explain(c: ScoredCandidate, n: number): string {
  const bits: string[] = [`elegido entre ${n} candidatos`];
  if (c.objectivePassed === true) bits.push('pasó la compuerta objetiva (tests/typecheck)');
  else if (c.objectivePassed === false) bits.push('⚠ ninguno pasó la compuerta objetiva; mejor relativo');
  bits.push(c.verifierPassed ? 'verificador aprobó' : 'verificador no aprobó (mejor relativo)');
  bits.push(`score=${clamp01(c.score).toFixed(2)}`);
  if (c.loopAborts) bits.push(`${c.loopAborts} bucle(s) abortado(s)`);
  bits.push(`${c.iterations} iteraciones`);
  return bits.join(' · ');
}
