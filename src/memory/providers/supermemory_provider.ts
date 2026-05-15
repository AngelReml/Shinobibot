/**
 * SupermemoryProvider — cliente HTTP a https://supermemory.ai (REST API).
 *
 * Vars:
 *   - SUPERMEMORY_API_KEY: Bearer token
 *   - SUPERMEMORY_BASE_URL (opcional, default `https://api.supermemory.ai`)
 *
 * `fetchImpl` inyectable para tests.
 *
 * El esquema de la API es similar al de mem0: add + search + delete.
 */

import type {
  MemoryMessage, MemoryProvider, ProviderMetrics, RecallHit,
} from './types.js';
import type { FetchLike } from './mem0_provider.js';

export interface SupermemoryOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

export class SupermemoryProvider implements MemoryProvider {
  readonly id = 'supermemory';
  readonly label = 'Supermemory (supermemory.ai, hosted)';

  private apiKey: string;
  private baseUrl: string;
  private fetchImpl: FetchLike;
  private errors_ = 0;
  private cachedCount = 0;
  private recallSamples: number[] = [];

  constructor(opts: SupermemoryOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.SUPERMEMORY_API_KEY ?? '';
    this.baseUrl = (opts.baseUrl ?? process.env.SUPERMEMORY_BASE_URL ?? 'https://api.supermemory.ai').replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  async init(): Promise<void> {
    if (!this.apiKey) throw new Error('SUPERMEMORY_API_KEY no configurada');
  }

  private headers(): Record<string, string> {
    return {
      'authorization': `Bearer ${this.apiKey}`,
      'content-type': 'application/json',
    };
  }

  async store(msg: MemoryMessage): Promise<string> {
    // API v3: POST /v3/documents con {content}. Procesa async (status:queued).
    const body = JSON.stringify({
      content: msg.content,
      metadata: { role: msg.role, ts: msg.ts, ...(msg.metadata ?? {}) },
    });
    const res = await this.fetchImpl(`${this.baseUrl}/v3/documents`, {
      method: 'POST', headers: this.headers(), body,
    });
    if (!res.ok) {
      this.errors_++;
      throw new Error(`supermemory store HTTP ${res.status}`);
    }
    const j = await res.json();
    this.cachedCount++;
    return j?.id ?? 'supermemory-unknown';
  }

  async recall(query: string, k: number = 5): Promise<RecallHit[]> {
    const t0 = Date.now();
    try {
      // API v3: POST /v3/search con {q}. Respuesta {results:[{chunks,documentId,score,title}]}.
      const body = JSON.stringify({ q: query, limit: k });
      const res = await this.fetchImpl(`${this.baseUrl}/v3/search`, {
        method: 'POST', headers: this.headers(), body,
      });
      if (!res.ok) {
        this.errors_++;
        throw new Error(`supermemory search HTTP ${res.status}`);
      }
      const j = await res.json();
      const arr = Array.isArray(j) ? j : j?.results ?? [];
      return arr.map((r: any): RecallHit => {
        // El texto vive en chunks[]; concatenamos los relevantes.
        const chunkText = Array.isArray(r.chunks)
          ? r.chunks.map((c: any) => c.content ?? '').filter(Boolean).join(' ')
          : '';
        return {
          message: {
            id: r.documentId ?? r.id,
            role: (r.metadata?.role as any) ?? 'user',
            content: chunkText || r.content || '',
            ts: r.metadata?.ts ?? r.createdAt,
            metadata: r.metadata,
          },
          score: r.score ?? 0,
          matchType: 'vector',
        };
      });
    } finally {
      this.recallSamples.push(Date.now() - t0);
      if (this.recallSamples.length > 50) this.recallSamples.shift();
    }
  }

  async forget(id: string): Promise<boolean> {
    const res = await this.fetchImpl(`${this.baseUrl}/v3/documents/${encodeURIComponent(id)}`, {
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
