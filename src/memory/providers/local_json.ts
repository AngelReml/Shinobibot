/**
 * LocalJsonProvider — backend de memoria local PERSISTENTE.
 *
 * Bug C6 de la auditoría 2026-05-16: el provider `local` (default) nunca
 * tenía factory cableado y el registry degradaba en silencio a
 * `InMemoryProvider` (volátil en RAM) — se perdía toda la memoria al
 * reiniciar, presentándola como persistencia local.
 *
 * Este provider persiste a un fichero JSON bajo `%APPDATA%\Shinobi\` con
 * escritura atómica (temp + rename), así que sobrevive a reinicios. El
 * recall es textual (Jaccard sobre tokens) — sin embeddings; el store con
 * embeddings sigue siendo `memory_store.ts` (SQLite). Este provider cubre
 * la ruta del `MemoryProviderRegistry` de forma honesta y sin dependencias.
 */

import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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

function defaultPath(): string {
  const dir = path.join(process.env.APPDATA || os.homedir(), 'Shinobi');
  return path.join(dir, 'memory_provider.json');
}

export class LocalJsonProvider implements MemoryProvider {
  readonly id = 'local';
  readonly label = 'Local JSON (persistente)';

  private store_: Map<string, MemoryMessage> = new Map();
  private errors_ = 0;
  private recallSamples: number[] = [];
  private readonly filePath: string;
  /** Cola de escritura: serializa los save para evitar lost-update. */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(filePath?: string) {
    this.filePath = filePath ?? defaultPath();
  }

  async init(): Promise<void> {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const arr = JSON.parse(raw) as MemoryMessage[];
        if (Array.isArray(arr)) {
          for (const m of arr) if (m && m.id) this.store_.set(m.id, m);
        }
      }
    } catch (e: any) {
      this.errors_++;
      console.warn(`[LocalJsonProvider] no se pudo cargar ${this.filePath}: ${e?.message ?? e}`);
    }
  }

  /** Escritura atómica (temp + rename) serializada por la cola. */
  private persist(): Promise<void> {
    this.writeChain = this.writeChain.then(() => {
      try {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const tmp = `${this.filePath}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(Array.from(this.store_.values()), null, 2));
        fs.renameSync(tmp, this.filePath);
      } catch (e: any) {
        this.errors_++;
        console.warn(`[LocalJsonProvider] fallo al persistir: ${e?.message ?? e}`);
      }
    });
    return this.writeChain;
  }

  async store(msg: MemoryMessage): Promise<string> {
    const id = msg.id ?? 'm_' + randomBytes(6).toString('hex');
    this.store_.set(id, { ...msg, id, ts: msg.ts ?? new Date().toISOString() });
    await this.persist();
    return id;
  }

  async recall(query: string, k: number = 5): Promise<RecallHit[]> {
    const t0 = Date.now();
    try {
      const qTok = tokenize(query);
      const hits: RecallHit[] = [];
      for (const m of this.store_.values()) {
        const score = jaccard(qTok, tokenize(m.content));
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
    const had = this.store_.delete(id);
    if (had) await this.persist();
    return had;
  }

  async consolidate(): Promise<{ removed: number; merged: number }> {
    const seen = new Map<string, MemoryMessage>();
    let removed = 0;
    for (const m of this.store_.values()) {
      const key = m.role + '|' + m.content;
      const existing = seen.get(key);
      if (existing) {
        const keep = (m.ts ?? '') > (existing.ts ?? '') ? m : existing;
        const drop = keep === m ? existing : m;
        if (drop.id) { this.store_.delete(drop.id); removed++; }
        seen.set(key, keep);
      } else {
        seen.set(key, m);
      }
    }
    if (removed > 0) await this.persist();
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
    await this.writeChain; // espera a que terminen las escrituras pendientes
  }
}
