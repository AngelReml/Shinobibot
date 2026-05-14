/**
 * Hash embedding backend — fallback determinístico cuando no hay ni
 * modelo local ni key de OpenAI. NO es semántico (mismas palabras →
 * mismo vector, paráfrasis falla). Existe solo para no romper el flujo
 * en builds offline sin modelo descargado.
 *
 * Se conserva la implementación histórica de
 * `EmbeddingProvider.fallbackEmbedding` (char-code bucketing) para que
 * los datos viejos persistidos sigan siendo comparables si alguien fuerza
 * `SHINOBI_EMBED_PROVIDER=hash`.
 */

import { l2Normalize, type EmbeddingBackend } from './types.js';

const DIM = 384;

export class HashEmbeddingProvider implements EmbeddingBackend {
  readonly name = 'hash';
  readonly dim = DIM;

  async isReady(): Promise<boolean> {
    return true;
  }

  async embed(text: string): Promise<number[]> {
    return hashEmbed(text, DIM);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(t => hashEmbed(t, DIM));
  }
}

export function hashEmbed(text: string, dim: number): number[] {
  const vec = new Array(dim).fill(0);
  const lower = (text || '').toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    vec[lower.charCodeAt(i) % dim] += 1;
  }
  return l2Normalize(vec);
}
