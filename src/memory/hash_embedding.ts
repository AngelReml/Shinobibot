/**
 * Hash-Based Embedding Fallback
 * 
 * Cuando EmbeddingProvider falla o está deshabilitado, genera un vector
 * determinístico basado en SHA256. NO es un reemplazo semántico real,
 * pero permite que el recall siga funcionando via keyword match.
 * 
 * Propiedades:
 * - Determinístico: mismo input → mismo vector siempre
 * - Rápido: sin I/O ni API calls
 * - Dimensión fija: 384 dims (compatible con local embeddings)
 */

import * as crypto from 'crypto';

export function hashBasedEmbedding(content: string, dims: number = 384): number[] {
  // Generar hash SHA256 del contenido
  const hash = crypto.createHash('sha256').update(content).digest();
  
  // Convertir bytes a números [0, 1]
  const vector: number[] = [];
  for (let i = 0; i < dims; i++) {
    const byteIndex = i % hash.length;
    const byte = hash[byteIndex];
    // Normalizar byte [0, 255] a [0, 1]
    vector.push(byte / 255);
  }
  
  // Normalizar a norma unitaria (como embeddings reales)
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] /= norm;
    }
  }
  
  return vector;
}

/**
 * Cosine similarity entre dos vectores (reutilizado de EmbeddingProvider)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}
