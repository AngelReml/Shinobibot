/**
 * FederatedSkillRegistry — orquesta múltiples fuentes en orden de
 * prioridad. Cuando el operador pide instalar `name`, prueba:
 *
 *   1. Local
 *   2. agentskills.io
 *   3. ClawHub
 *   4. GitHub (raw markdown)
 *
 * search() devuelve resultados de TODAS las fuentes mergeados,
 * deduplicados por nombre (gana la fuente de mayor prioridad).
 *
 * fetch() prueba en orden hasta encontrar; la primera devuelve.
 */

import { createHash } from 'crypto';
import {
  type RemoteSkillMeta, type SkillBundle, type SkillSource,
  SkillNotFoundError,
} from './types.js';

/** Se lanza cuando el body de un bundle no coincide con su hash declarado. */
export class SkillHashMismatchError extends Error {
  constructor(name: string, source: string, declared: string, actual: string) {
    super(`hash mismatch para '${name}' en fuente '${source}': declarado ${declared.slice(0, 12)}… ≠ real ${actual.slice(0, 12)}…`);
    this.name = 'SkillHashMismatchError';
  }
}

export interface FederatedRegistryOptions {
  sources?: SkillSource[];
}

export class FederatedSkillRegistry {
  private sources: SkillSource[];

  constructor(opts: FederatedRegistryOptions = {}) {
    const all = opts.sources ?? [];
    this.sources = all.slice().sort((a, b) => a.priority - b.priority);
  }

  /** Lista solo las fuentes configuradas para diagnóstico. */
  active(): Array<{ id: string; priority: number; configured: boolean }> {
    return this.sources.map(s => ({ id: s.id, priority: s.priority, configured: s.isConfigured() }));
  }

  /**
   * Búsqueda federada — pregunta a TODAS las fuentes configuradas en
   * paralelo y mergea. Errores de una fuente no abortan la búsqueda.
   */
  async search(query: string): Promise<RemoteSkillMeta[]> {
    const seen = new Map<string, RemoteSkillMeta>();
    const results = await Promise.allSettled(
      this.sources
        .filter(s => s.isConfigured())
        .map(s => s.search(query))
    );
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const meta of r.value) {
        const prev = seen.get(meta.name);
        if (!prev) seen.set(meta.name, meta);
      }
    }
    return Array.from(seen.values());
  }

  /**
   * Fetch ordenado: prueba fuentes por prioridad, devuelve la primera
   * que entregue el bundle. Si ninguna lo tiene, lanza SkillNotFoundError.
   */
  async fetch(name: string, version?: string): Promise<SkillBundle & { source: string }> {
    let lastError: unknown = null;
    for (const s of this.sources) {
      if (!s.isConfigured()) continue;
      try {
        const bundle = await s.fetch(name, version);
        // C10 — verifica que el body coincide con el hash declarado por la
        // fuente. Una fuente comprometida podría servir un body distinto al
        // hash anunciado; se rechaza y se prueba la siguiente fuente.
        if (bundle.declaredHash) {
          const actual = createHash('sha256').update(bundle.body).digest('hex');
          if (actual.toLowerCase() !== bundle.declaredHash.toLowerCase()) {
            lastError = new SkillHashMismatchError(name, s.id, bundle.declaredHash, actual);
            continue;
          }
        }
        return { ...bundle, source: s.id };
      } catch (e) {
        lastError = e;
        if (e instanceof SkillNotFoundError) continue;
        // Otro error (HTTP 500, timeout) — pasamos a la siguiente fuente
        // pero registramos.
        continue;
      }
    }
    if (lastError instanceof SkillNotFoundError) throw lastError;
    // Si la última fuente falló por hash manipulado, propaga ESE error (no
    // un genérico "not found") para que el caller sepa que fue rechazo C10.
    if (lastError instanceof SkillHashMismatchError) throw lastError;
    throw new SkillNotFoundError(name, 'federated');
  }
}
