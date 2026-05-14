/**
 * OpenAI embedding backend (`text-embedding-3-small`, 1536 dims).
 *
 * Requiere `OPENAI_API_KEY`. Cost: ~$0.02 / 1M tokens — irrelevante para
 * uso personal pero hay que decirlo. Calidad superior al local
 * (MiniLM-L6) en la mayoría de benchmarks. Latencia: ~80-200 ms /
 * request, mejor cuando se manda batch (hasta 2048 inputs por llamada).
 */

import axios from 'axios';
import { l2Normalize, type EmbeddingBackend } from './types.js';

const MODEL = 'text-embedding-3-small';
const DIM = 1536;
const ENDPOINT = 'https://api.openai.com/v1/embeddings';
const MAX_BATCH = 2048;
const TIMEOUT_MS = 30_000;

export class OpenAIEmbeddingProvider implements EmbeddingBackend {
  readonly name = 'openai';
  readonly dim = DIM;

  async isReady(): Promise<boolean> {
    return !!process.env.OPENAI_API_KEY;
  }

  async embed(text: string): Promise<number[]> {
    const out = await this.embedBatch([text]);
    return out[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY no está definida; el provider OpenAI no es invocable.');

    const safe = texts.map(t => (t && t.length > 0 ? t : ' '));
    const results: number[][] = [];

    for (let i = 0; i < safe.length; i += MAX_BATCH) {
      const chunk = safe.slice(i, i + MAX_BATCH);
      const resp = await axios.post(
        ENDPOINT,
        { model: MODEL, input: chunk, encoding_format: 'float' },
        {
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          timeout: TIMEOUT_MS,
        },
      );
      const data = resp.data?.data;
      if (!Array.isArray(data) || data.length !== chunk.length) {
        throw new Error(`OpenAI embeddings: respuesta inesperada (len=${data?.length}, esperado ${chunk.length})`);
      }
      for (const row of data) {
        const vec = row?.embedding;
        if (!Array.isArray(vec)) throw new Error('OpenAI embeddings: vector ausente en row');
        results.push(l2Normalize(vec));
      }
    }
    return results;
  }
}
