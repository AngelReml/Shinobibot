/**
 * Mem0Provider — cliente HTTP a https://mem0.ai (REST API).
 *
 * Mem0 ofrece memoria semántica gestionada con embeddings, búsqueda
 * vectorial y gestión de contexto. Aquí solo hablamos HTTP — sin SDK.
 *
 * Vars:
 *   - MEM0_API_KEY: token Bearer (alta humana en mem0.ai)
 *   - MEM0_BASE_URL (opcional, default `https://api.mem0.ai`)
 *   - MEM0_USER_ID  (opcional, default `default`)
 *
 * Si la API key no está configurada, `init()` lanza claro.
 *
 * `fetchImpl` es inyectable para tests sin red.
 */

import type {
  MemoryMessage, MemoryProvider, ProviderMetrics, RecallHit,
} from './types.js';

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export interface Mem0Options {
  apiKey?: string;
  baseUrl?: string;
  userId?: string;
  fetchImpl?: FetchLike;
}

export class Mem0Provider implements MemoryProvider {
  readonly id = 'mem0';
  readonly label = 'Mem0 (mem0.ai, hosted)';

  private apiKey: string;
  private baseUrl: string;
  private userId: string;
  private fetchImpl: FetchLike;
  private errors_ = 0;
  private cachedCount = 0;
  private recallSamples: number[] = [];

  constructor(opts: Mem0Options = {}) {
    this.apiKey = opts.apiKey ?? process.env.MEM0_API_KEY ?? '';
    this.baseUrl = (opts.baseUrl ?? process.env.MEM0_BASE_URL ?? 'https://api.mem0.ai').replace(/\/$/, '');
    this.userId = opts.userId ?? process.env.MEM0_USER_ID ?? 'default';
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  async init(): Promise<void> {
    if (!this.apiKey) {
      throw new Error('MEM0_API_KEY no configurada (mem0.ai)');
    }
  }

  private headers(): Record<string, string> {
    return {
      'authorization': `Token ${this.apiKey}`,
      'content-type': 'application/json',
    };
  }

  async store(msg: MemoryMessage): Promise<string> {
    const body = JSON.stringify({
      messages: [{ role: msg.role, content: msg.content }],
      user_id: this.userId,
      metadata: msg.metadata ?? {},
    });
    const res = await this.fetchImpl(`${this.baseUrl}/v1/memories/`, {
      method: 'POST', headers: this.headers(), body,
    });
    if (!res.ok) {
      this.errors_++;
      throw new Error(`mem0 store HTTP ${res.status}`);
    }
    const j = await res.json();
    this.cachedCount++;
    // mem0 v1 devuelve {results: [{id}]} o similar; toleramos formato.
    return j?.results?.[0]?.id ?? j?.id ?? 'mem0-unknown';
  }

  async recall(query: string, k: number = 5): Promise<RecallHit[]> {
    const t0 = Date.now();
    try {
      const body = JSON.stringify({ query, user_id: this.userId, limit: k });
      const res = await this.fetchImpl(`${this.baseUrl}/v1/memories/search/`, {
        method: 'POST', headers: this.headers(), body,
      });
      if (!res.ok) {
        this.errors_++;
        throw new Error(`mem0 search HTTP ${res.status}`);
      }
      const j = await res.json();
      const arr = Array.isArray(j) ? j : j?.results ?? [];
      return arr.map((r: any): RecallHit => ({
        message: {
          id: r.id,
          role: r.role ?? 'user',
          content: r.memory ?? r.content ?? '',
          ts: r.created_at,
          metadata: r.metadata,
        },
        score: r.score ?? 0,
        matchType: 'vector',
      }));
    } finally {
      this.recallSamples.push(Date.now() - t0);
      if (this.recallSamples.length > 50) this.recallSamples.shift();
    }
  }

  async forget(id: string): Promise<boolean> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/memories/${encodeURIComponent(id)}/`, {
      method: 'DELETE', headers: this.headers(),
    });
    if (!res.ok) this.errors_++;
    return res.ok;
  }

  async metrics(): Promise<ProviderMetrics> {
    const avg = this.recallSamples.length
      ? this.recallSamples.reduce((a, b) => a + b, 0) / this.recallSamples.length
      : 0;
    return {
      count: this.cachedCount,
      recallAvgMs: Math.round(avg),
      errors: this.errors_,
      healthy: this.errors_ < 5,
    };
  }
}
