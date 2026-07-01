/**
 * embedding_math.ts — utilidades matemáticas puras compartidas por el
 * subsistema de embeddings (Bloque 4 — Memoria).
 *
 * F0.6 (remediación quirúrgica): existían DOS implementaciones idénticas de
 * `cosineSimilarity` (una viva en `embedding_provider.ts`, otra muerta sin
 * caller en el ya eliminado `hash_embedding.ts`). Esta es la única fuente
 * de verdad ahora — `EmbeddingProvider.cosineSimilarity` delega aquí.
 *
 * Sin dependencias, sin estado, cero I/O — solo aritmética sobre vectores.
 */

/**
 * Cosine similarity entre dos vectores. Si están L2-normalizados (norma 1,
 * ver `l2Normalize` en `embedding_providers/types.ts`) esto equivale al
 * producto punto puro, pero esta implementación no asume normalización:
 * calcula las normas explícitamente para ser correcta con cualquier vector.
 *
 * @returns similitud en [-1, 1]; 0 si las dimensiones no coinciden o si
 *          alguno de los vectores es el vector cero (evita división por 0).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
