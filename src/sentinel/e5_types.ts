/**
 * E5 — ANTICIPADOR: tipos del flujo de señal → claims → hipótesis → briefing.
 *
 * Cada claim tiene procedencia firmada y ventana de validez temporal (E4).
 * Cada hipótesis está anclada a una dimensión medible del benchmark.
 * Si un claim no mapea a ninguna dimensión → es una nota, no una hipótesis.
 */

/** Dimensiones medibles del benchmark de Shinobi. Toda hipótesis debe anclar a una. */
export type E5Dimension =
  | 'pass@1'          // tasa de éxito en tareas (pass@1 en benchmark)
  | 'pass_k'          // consistencia k corridas (pass^k)
  | 'safety'          // acciones irreversibles sin permiso = 0
  | 'verificability'  // provenance firmada + audit chain
  | 'self_correction' // auto-detección y corrección de errores
  | 'latency'         // velocidad de respuesta
  | 'cost'            // tokens/USD por tarea
  | 'accessibility';  // usabilidad por usuario no técnico

export type E5CredLevel = 'SOLID' | 'PLAUSIBLE' | 'UNFOUNDED';

/** Un claim extraído de un SentinelItem con credibilidad y ventana de validez. */
export interface E5Claim {
  claimId: string;
  /** Afirmación en una frase. */
  text: string;
  /** Cita literal del texto fuente (o fragmento relevante). */
  quote: string;
  /** URL canónica de la fuente. */
  sourceUrl: string;
  sourceName: string;
  /** ISO timestamp de publicación de la fuente. */
  publishedAt: string;
  /** ISO timestamp de captura por Shinobi. */
  capturedAt: string;
  credibility: E5CredLevel;
  credibilityScore: number; // 0..1
  /** Dimensión del benchmark a la que aplica. undefined → nota, no se persigue como hipótesis. */
  dimension?: E5Dimension;
  /** Ventana de validez para la memoria temporal E4. */
  valid_from: string;
  valid_until: string;
  /** Id del SentinelItem del que viene. */
  sourceItemId: string;
}

/** Una hipótesis destilada de uno o más claims, anclada a una dimensión medible. */
export interface E5Hypothesis {
  hypothesisId: string;
  title: string;
  description: string;
  /** Dimensión medible que mejoraría si la hipótesis es correcta. */
  dimension: E5Dimension;
  /** Claims que la sustentan (claimIds). */
  supportingClaims: string[];
  credibility: E5CredLevel;
  credibilityScore: number;
  createdAt: string;
  /** betId si el operador la ha registrado como apuesta. */
  betId?: string;
}

/** Una apuesta registrada por el operador sobre una hipótesis. */
export interface E5Bet {
  betId: string;
  hypothesisId: string;
  title: string;
  dimension: E5Dimension;
  credibilityAtBet: E5CredLevel;
  registeredAt: string;
  /** null = pendiente */
  outcome: 'WIN' | 'MISS' | 'PARTIAL' | null;
  resolvedAt: string | null;
  /**
   * Puntuación de calibración asimétrica.
   * WIN=+1, PARTIAL=+0.3, MISS=-2 (false negatives penalizan el doble).
   * null si aún pendiente.
   */
  calibrationScore: number | null;
}

/** Una entrada en el briefing al operador. */
export interface E5BriefingEntry {
  dimension: E5Dimension;
  hypothesis: E5Hypothesis;
  pendingBet: boolean;
  /** Claims de soporte resumidos. */
  evidence: string[];
}
