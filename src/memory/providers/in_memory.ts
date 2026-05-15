/**
 * InMemoryProvider — store en RAM para tests y entornos efímeros.
 *
 * Implementa text-based recall con Jaccard sobre tokens. Sin embeddings
 * (eso es trabajo del LocalSqliteProvider). Útil porque:
 *   - Permite escribir tests de orchestrator sin tocar disco.
 *   - Permite modo "no-persistence" cuando el operador pide olvidar.
 */

import { randomBytes } from 'crypto';
import type {
  MemoryMessage, MemoryProvider, ProviderMetrics, RecallHit,
} from './types.js';

function tokenize(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/\W+/).filter(w => w.length >= 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export class InMemoryProvider implements MemoryProvider {
  readonly id = 'in_memory';
  readonly label = 'In-Memory (volatile, tests)';

  private store_: Map<string, MemoryMessage> = new Map();
  private errors_ = 0;
  private recallSamples: number[] = [];

  async init(): Promise<void> { /* nada */ }

  async store(msg: MemoryMessage): Promise<string> {
    const id = msg.id ?? 'm_' + randomBytes(6).toString('hex');
    this.store_.set(id, {
      ...msg,
      id,
      ts: msg.ts ?? new Date().toISOString(),
    });
    return id;
  }

  async recall(query: string, k: number = 5): Promise<RecallHit[]> {
    const t0 = Date.now();
    try {
      const qTok = tokenize(query);
      const hits: RecallHit[] = [];
      for (const m of this.store_.values()) {
        const mTok = tokenize(m.content);
        const score = jaccard(qTok, mTok);
        if (score > 0) hits.push({ message: m, score, matchType: 'text' });
      }
      hits.sort((a, b) => b.score - a.score);
      return hits.slice(0, k);
    } finally {
      const dt = Date.now() - t0;
      this.recallSamples.push(dt);
      if (this.recallSamples.length > 50) this.recallSamples.shift();
    }
  }

  async forget(id: string): Promise<boolean> {
    return this.store_.delete(id);
  }

  async consolidate(): Promise<{ removed: number; merged: number }> {
    // Elimina mensajes idénticos (mismo role+content); conserva el más reciente.
    const seen = new Map<string, MemoryMessage>();
    let removed = 0;
    for (const m of this.store_.values()) {
      const key = m.role + '|' + m.content;
      const existing = seen.get(key);
      if (existing) {
        const keep = (m.ts ?? '') > (existing.ts ?? '') ? m : existing;
        const drop = keep === m ? existing : m;
        if (drop.id) {
          this.store_.delete(drop.id);
          removed++;
        }
        seen.set(key, keep);
      } else {
        seen.set(key, m);
      }
    }
    return { removed, merged: 0 };
  }

  async metrics(): Promise<ProviderMetrics> {
    const bytes = Array.from(this.store_.values())
      .reduce((acc, m) => acc + m.content.length * 2, 0);
    const avg = this.recallSamples.length
      ? this.recallSamples.reduce((a, b) => a + b, 0) / this.recallSamples.length
      : 0;
    return {
      count: this.store_.size,
      bytes,
      recallAvgMs: Math.round(avg),
      errors: this.errors_,
      healthy: true,
    };
  }

  async shutdown(): Promise<void> {
    this.store_.clear();
  }

  /** Helper para tests: vaciar sin shutdown. */
  _clearForTests(): void {
    this.store_.clear();
    this.errors_ = 0;
    this.recallSamples = [];
  }
}
