import { OpenGravityClient } from '../cloud/opengravity_client.js';

const EMBEDDING_DIM = 1536;
const FALLBACK_DIM = 384;

export class EmbeddingProvider {
  public static async embed(text: string): Promise<number[]> {
    const result = await OpenGravityClient.invokeLLM({
      messages: [
        { role: 'system', content: 'You produce JSON-only embeddings.' },
        { role: 'user', content: `Produce a deterministic ${FALLBACK_DIM}-dimension semantic vector for the following text. Reply ONLY with a JSON array of ${FALLBACK_DIM} float numbers between -1 and 1, no prose.\n\nText: ${text.substring(0, 2000)}` }
      ],
      temperature: 0.0
    } as any);

    if (result.success && result.output) {
      try {
        const message = JSON.parse(result.output);
        const content = message.content || '';
        const match = content.match(/\[[\s\S]*\]/);
        if (match) {
          const arr = JSON.parse(match[0]);
          if (Array.isArray(arr) && arr.length > 0) {
            return this.padOrTruncate(arr.map((x: any) => Number(x) || 0), FALLBACK_DIM);
          }
        }
      } catch {}
    }
    return this.fallbackEmbedding(text, FALLBACK_DIM);
  }

  private static fallbackEmbedding(text: string, dim: number): number[] {
    const vec = new Array(dim).fill(0);
    const lower = text.toLowerCase();
    for (let i = 0; i < lower.length; i++) {
      const code = lower.charCodeAt(i);
      vec[code % dim] += 1;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map(v => v / norm);
  }

  private static padOrTruncate(vec: number[], dim: number): number[] {
    if (vec.length === dim) return vec;
    if (vec.length > dim) return vec.slice(0, dim);
    return [...vec, ...new Array(dim - vec.length).fill(0)];
  }

  public static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
  }
}
