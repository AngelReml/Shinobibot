/**
 * MemoryProviderRegistry — selección + init de proveedores de memoria.
 *
 * El operador elige vía env `SHINOBI_MEMORY_PROVIDER`:
 *   - 'local'       (default): persistente a JSON local (`LocalJsonProvider`)
 *   - 'in_memory'   : volátil RAM (tests + sesiones sin persistencia)
 *   - 'mem0'        : mem0.ai (requiere MEM0_API_KEY)
 *   - 'supermemory' : supermemory.ai (requiere SUPERMEMORY_API_KEY)
 *
 * El registry hace lazy init: el provider se instancia solo cuando
 * alguien lo pide, y se cachea para futuras llamadas.
 *
 * Útil para `/admin/memory` y para que el orchestrator pueda preguntar
 * "¿qué provider está activo, está sano, cuántas memories tiene?".
 */

import type { MemoryProvider } from './providers/types.js';
import { InMemoryProvider } from './providers/in_memory.js';
import { LocalJsonProvider } from './providers/local_json.js';
import { Mem0Provider } from './providers/mem0_provider.js';
import { SupermemoryProvider } from './providers/supermemory_provider.js';

export type ProviderId = 'local' | 'in_memory' | 'mem0' | 'supermemory';

const VALID_IDS: ReadonlySet<ProviderId> = new Set(['local', 'in_memory', 'mem0', 'supermemory']);

export interface RegistryOptions {
  /** Override de la env var. */
  providerId?: ProviderId;
  /** Constructor custom de 'local' (para integrar con `memory_store` legacy). */
  localFactory?: () => MemoryProvider;
}

export class MemoryProviderRegistry {
  private cached: MemoryProvider | null = null;
  private resolvedId: ProviderId;
  private localFactory?: () => MemoryProvider;

  constructor(opts: RegistryOptions = {}) {
    const fromEnv = process.env.SHINOBI_MEMORY_PROVIDER as ProviderId | undefined;
    const candidate = opts.providerId ?? fromEnv ?? 'local';
    this.resolvedId = VALID_IDS.has(candidate as ProviderId) ? (candidate as ProviderId) : 'local';
    this.localFactory = opts.localFactory;
  }

  get activeId(): ProviderId { return this.resolvedId; }

  /** Devuelve el provider, instanciando si hace falta. */
  async getProvider(): Promise<MemoryProvider> {
    if (this.cached) return this.cached;
    this.cached = this.instantiate();
    if (this.cached.init) await this.cached.init();
    return this.cached;
  }

  private instantiate(): MemoryProvider {
    switch (this.resolvedId) {
      case 'in_memory': return new InMemoryProvider();
      case 'mem0':      return new Mem0Provider();
      case 'supermemory': return new SupermemoryProvider();
      case 'local':
      default:
        // Si el caller inyectó un factory custom, se respeta. Si no, se usa
        // LocalJsonProvider: persistente a disco (bug C6 — antes degradaba
        // en silencio a InMemoryProvider volátil).
        if (this.localFactory) return this.localFactory();
        return new LocalJsonProvider();
    }
  }

  async shutdown(): Promise<void> {
    if (this.cached?.shutdown) await this.cached.shutdown();
    this.cached = null;
  }

  /** Para tests: forzar re-instanciación. */
  _resetForTests(): void {
    this.cached = null;
  }
}

let singleton: MemoryProviderRegistry | null = null;
export function memoryProviderRegistry(): MemoryProviderRegistry {
  if (!singleton) singleton = new MemoryProviderRegistry();
  return singleton;
}

export function _resetMemoryProviderRegistry(): void {
  singleton = null;
}
