/**
 * Contrato común para backends de embeddings reales (Sprint 1.1).
 *
 * Todas las implementaciones deben:
 *   - Exponer la dimensión exacta del vector que producen (no variable).
 *   - Aceptar texto arbitrario y devolver un vector L2-normalizado (norma 1).
 *   - Soportar `embedBatch` cuando el backend permite hacerlo en una sola
 *     llamada (OpenAI, Transformers.js). Para los que no, la base class
 *     hace fallback secuencial.
 *
 * Razón de la normalización: el cosine similarity sobre vectores
 * normalizados se reduce a un producto punto, lo que hace la recall
 * más barata en la pasada sobre la tabla `memories`.
 */

export interface EmbeddingBackend {
  /** Identificador corto para logs y telemetría ("local" | "openai" | "hash"). */
  readonly name: string;
  /** Dimensión fija que produce cada vector. */
  readonly dim: number;
  /** Devuelve true si el backend puede atender la request en su estado actual. */
  isReady(): Promise<boolean>;
  /** Genera un único embedding L2-normalizado. */
  embed(text: string): Promise<number[]>;
  /** Genera N embeddings en una sola llamada cuando se puede. */
  embedBatch(texts: string[]): Promise<number[][]>;
}

/** Tipo del nombre de proveedor seleccionable via env. */
export type EmbeddingProviderName = 'local' | 'openai' | 'hash';

/** Normaliza un vector a norma L2 = 1. Útil para que cosine == dot. */
export function l2Normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) sumSq += vec[i] * vec[i];
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return vec.slice();
  const out = new Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}
