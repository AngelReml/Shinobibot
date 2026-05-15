/**
 * MemoryProvider — interfaz común para backends de memoria
 * persistente.
 *
 * Permite que Shinobi use SQLite local (default), mem0.ai, supermemory,
 * o un store en memoria para tests bajo la misma API.
 *
 * El registry (`provider_registry.ts`) elige uno vía env
 * `SHINOBI_MEMORY_PROVIDER`. Default `local`.
 */

export interface MemoryMessage {
  /** ID opcional (algunos providers lo asignan). */
  id?: string;
  /** Rol del speaker (user/assistant/system/tool). */
  role: 'user' | 'assistant' | 'system' | 'tool';
  /** Contenido textual. */
  content: string;
  /** ISO timestamp. */
  ts?: string;
  /** Metadata libre (tags, sessionId, userId). */
  metadata?: Record<string, unknown>;
}

export interface RecallHit {
  message: MemoryMessage;
  /** Score 0..1 — 1 es exact match semántico/textual. */
  score: number;
  /** Cómo se hizo el match: 'vector' | 'text' | 'tag'. */
  matchType: 'vector' | 'text' | 'tag';
}

export interface ProviderMetrics {
  /** Total mensajes almacenados. */
  count: number;
  /** Bytes aproximados consumidos. */
  bytes?: number;
  /** Latencia media recall ms (ventana últimas N). */
  recallAvgMs?: number;
  /** Errores acumulados desde start. */
  errors: number;
  /** Estado del backend. */
  healthy: boolean;
}

export interface MemoryProvider {
  /** Identificador estable (snake_case). */
  readonly id: string;
  /** Label legible. */
  readonly label: string;

  /** Inicialización (opcional). Idempotente. */
  init?(): Promise<void>;

  /** Persiste un mensaje. Devuelve id asignado si aplica. */
  store(msg: MemoryMessage): Promise<string>;

  /** Búsqueda semántica/textual. k = top results. */
  recall(query: string, k?: number): Promise<RecallHit[]>;

  /** Borra un mensaje. Devuelve true si se borró algo. */
  forget(id: string): Promise<boolean>;

  /** Compacta / consolida (opcional). */
  consolidate?(): Promise<{ removed: number; merged: number }>;

  /** Métricas para `/admin/memory`. */
  metrics(): Promise<ProviderMetrics>;

  /** Apagado limpio. */
  shutdown?(): Promise<void>;
}
