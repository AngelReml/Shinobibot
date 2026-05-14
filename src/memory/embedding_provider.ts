/**
 * EmbeddingProvider — fachada estática para el backend de embeddings.
 *
 * Sprint 1.1 (memoria vectorial real): el viejo provider que delegaba en
 * el LLM (no-determinístico, no semántico) o en un char-code bucket
 * (anti-semántico) se reemplaza por un factory de backends reales con
 * cache singleton. Mantiene la API estática `embed()` y
 * `cosineSimilarity()` para no romper a MemoryStore ni a SkillManager.
 */

import { getEmbeddingBackend, currentEmbeddingBackendName } from './embedding_providers/factory.js';

export class EmbeddingProvider {
  public static async embed(text: string): Promise<number[]> {
    const backend = await getEmbeddingBackend();
    return backend.embed(text);
  }

  public static async embedBatch(texts: string[]): Promise<number[][]> {
    const backend = await getEmbeddingBackend();
    return backend.embedBatch(texts);
  }

  public static async dim(): Promise<number> {
    const backend = await getEmbeddingBackend();
    return backend.dim;
  }

  public static async providerName(): Promise<string> {
    return currentEmbeddingBackendName();
  }

  /**
   * Producto punto sobre vectores. Si están L2-normalizados (lo que
   * hacen todos los backends del factory) esto equivale al cosine
   * similarity y es ~2x más rápido que recalcular las normas.
   */
  public static cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
  }
}
