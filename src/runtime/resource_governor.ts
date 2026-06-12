// src/runtime/resource_governor.ts
//
// MOTOR E8 — EL CENTRO QUE NO SE PIERDE BAJO PRESIÓN (刃 sobre 心).
//
// Doctrina del hanko 忍: aguantar la presión sin perder el centro. Bajo la
// superficie del chat en calma hay un enjambre de procesos cazando — y ese
// enjambre NO puede colapsar la máquina del operador. El governor es el único
// punto que conoce TODA la concurrencia del proceso (misiones, sub-agentes,
// swarms, multi-usuario) y la mantiene acotada:
//
//   - **Cap duro** de concurrencia → la PC nunca se ahoga, pase lo que pase.
//   - **Equidad por operador** → varias personas lanzando a la vez coexisten;
//     nadie monopoliza ni mata de hambre a otro (selva multi-usuario).
//   - **Backpressure** → más allá de la cola, se rechaza con honestidad en vez
//     de aceptar trabajo que tumbaría el sistema. La selva no promete lo que no
//     puede cazar.
//   - **Ancho adaptativo** → bajo presión real, el ancho se encoge hacia un
//     suelo; rápido y ágil cuando hay aire, imperceptible cuando aprieta.
//
// El núcleo de decisión (effectiveWidth, decideAdmission) es PURO y determinista
// → testeable aislado y portado a un proof en Node. La clase orquesta sin imports
// pesados (cero I/O), así que también se prueba su invariante de concurrencia.

export type AdmissionDecision = 'run' | 'queue' | 'shed';

export interface GovernorConfig {
  /** Cap DURO de concurrencia simultánea en todo el proceso. */
  maxConcurrency: number;
  /** Máximo simultáneo por operador (equidad: nadie monopoliza). */
  perTenantCap: number;
  /** Tamaño máximo de la cola antes de rechazar (backpressure). */
  maxQueue: number;
  /** Suelo de concurrencia al degradar bajo presión (default max/4, mín 1). */
  minConcurrency?: number;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Ancho efectivo según la presión (0..1). load=0 → ancho máximo (ágil);
 * load=1 → suelo (imperceptible, no ahoga la PC). Lineal y determinista.
 */
export function effectiveWidth(cfg: GovernorConfig, loadFactor: number): number {
  const floor = Math.max(1, cfg.minConcurrency ?? Math.floor(cfg.maxConcurrency / 4));
  const lf = clamp01(loadFactor);
  const w = Math.round(cfg.maxConcurrency - (cfg.maxConcurrency - floor) * lf);
  return Math.max(floor, Math.min(cfg.maxConcurrency, w));
}

export interface AdmissionState {
  running: number;
  perTenant: Map<string, number>;
  queued: number;
}

/** Decisión PURA de admisión: correr ya, encolar, o rechazar (backpressure). */
export function decideAdmission(state: AdmissionState, tenant: string, cfg: GovernorConfig, width: number): AdmissionDecision {
  const tenantRunning = state.perTenant.get(tenant) ?? 0;
  const underTenantCap = tenantRunning < cfg.perTenantCap;
  if (state.running < width && underTenantCap) return 'run';
  if (state.queued < cfg.maxQueue) return 'queue';
  return 'shed';
}

/** Se lanza cuando el governor rechaza por backpressure (carga excesiva). */
export class GovernorShedError extends Error {
  constructor(public readonly tenant: string) {
    super(`governor: carga rechazada por backpressure (operador ${tenant})`);
    this.name = 'GovernorShedError';
  }
}

interface QueueItem<T = unknown> {
  tenant: string;
  work: () => Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

export interface GovernorSnapshot {
  running: number;
  queued: number;
  width: number;
  perTenant: Record<string, number>;
}

/**
 * Governor process-wide. Admite/encola/rechaza unidades de trabajo respetando el
 * cap duro, la equidad por operador y el backpressure, con ancho adaptativo. NO
 * mata trabajo en vuelo: solo deja de admitir, y la concurrencia drena sola.
 */
export class ResourceGovernor {
  private running = 0;
  private readonly perTenant = new Map<string, number>();
  private readonly queue: QueueItem<any>[] = [];
  private loadFactor = 0;
  private readonly cfg: GovernorConfig;

  constructor(cfg: GovernorConfig) {
    this.cfg = cfg;
  }

  /** Señal de presión externa (0..1): CPU/mem/latencia. Encoge el ancho. */
  setLoad(loadFactor: number): void {
    this.loadFactor = clamp01(loadFactor);
    this.drain();
  }

  width(): number {
    return effectiveWidth(this.cfg, this.loadFactor);
  }

  snapshot(): GovernorSnapshot {
    return {
      running: this.running,
      queued: this.queue.length,
      width: this.width(),
      perTenant: Object.fromEntries(this.perTenant),
    };
  }

  /**
   * Ejecuta `work` bajo el governor. Corre ya si hay aire; si no, encola; si la
   * cola está llena, lanza GovernorShedError (backpressure honesto). La promesa
   * resuelve/rechaza con el resultado de `work` cuando finalmente corre.
   */
  run<T>(tenant: string, work: () => Promise<T>): Promise<T> {
    const decision = decideAdmission(
      { running: this.running, perTenant: this.perTenant, queued: this.queue.length },
      tenant, this.cfg, this.width(),
    );
    if (decision === 'shed') return Promise.reject(new GovernorShedError(tenant));
    if (decision === 'run') return this.execute(tenant, work);
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ tenant, work, resolve, reject });
    });
  }

  private execute<T>(tenant: string, work: () => Promise<T>): Promise<T> {
    this.running++;
    this.perTenant.set(tenant, (this.perTenant.get(tenant) ?? 0) + 1);
    const done = () => {
      this.running--;
      const n = (this.perTenant.get(tenant) ?? 1) - 1;
      if (n <= 0) this.perTenant.delete(tenant); else this.perTenant.set(tenant, n);
      this.drain();
    };
    // Ejecuta y libera SIEMPRE (éxito o fallo). No traga el error: lo propaga.
    return Promise.resolve()
      .then(work)
      .then(
        (v) => { done(); return v; },
        (e) => { done(); throw e; },
      );
  }

  /** Drena la cola mientras haya ancho, honrando la equidad por operador. */
  private drain(): void {
    while (this.running < this.width()) {
      const idx = this.pickFair();
      if (idx < 0) break;
      const item = this.queue.splice(idx, 1)[0];
      this.execute(item.tenant, item.work).then(item.resolve, item.reject);
    }
  }

  /** Primer encolado cuyo operador esté por debajo de su cap (anti-monopolio). */
  private pickFair(): number {
    for (let i = 0; i < this.queue.length; i++) {
      const t = this.queue[i].tenant;
      if ((this.perTenant.get(t) ?? 0) < this.cfg.perTenantCap) return i;
    }
    return -1;
  }
}
