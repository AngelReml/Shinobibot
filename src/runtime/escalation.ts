// src/runtime/escalation.ts
//
// MOTOR E8 — IMPARABLE HACIA EL OBJETIVO, DESDE LAS SOMBRAS.
//
// "Cuando actúa, nada lo frena; debe alcanzar su objetivo." Pero la selva no es
// temeraria: es relentless con MÉTODO. Ante un fallo, Shinobi no se rinde — vuelve
// a intentar, rota de proveedor, y si la tarea PESA acude a su ejército (swarm).
// Lo único que lo detiene: un fallo fatal, agotar el presupuesto, o el
// loop-detector avisando de un bucle estéril (el candado de la disciplina).
//
// Todo PURO e INYECTABLE (classify, onFailover, onSwarm, sleep, onAbortSignal se
// pasan): testeable al instante sin red ni esperas, y sin arrastrar el grafo
// pesado. El wiring real (classifyFailureMode + runSwarm + el loop-detector) se
// hace en el call-site.

export type EscalationAction = 'retry' | 'failover' | 'swarm' | 'give_up';

export interface EscalationInput {
  /** Intento actual, 1-based. */
  attempt: number;
  maxAttempts: number;
  /** Modo de fallo de entorno (de classifyFailureMode), si aplica. */
  failureMode?: string | null;
  /** Peso de la tarea 0..1 (heurística): ≥0.6 = pesada → candidata a enjambre. */
  taskWeight?: number;
  /** Fallo fatal (payload irrecuperable): lo único que corta en seco. */
  fatal?: boolean;
  /** Ya se escaló al enjambre antes (no se escala dos veces). */
  swarmTried?: boolean;
}

/** Modos de entorno recuperables rotando proveedor (alinea con loop_detector). */
const FAILOVER_MODES = new Set(['rate_limit', 'api_key', 'network', 'auth']);
const RETRY_MODES = new Set(['transient', 'timeout', 'browser_down', 'unknown']);

/**
 * Decide el siguiente movimiento. Relentless pero acotado:
 *   - fatal → give_up (único freno duro).
 *   - tarea PESADA y aún sin enjambre, pasada la mitad del presupuesto → swarm.
 *   - presupuesto agotado → último cartucho al ejército si pesa y no se probó;
 *     si no, give_up con honestidad (nunca finge éxito).
 *   - fallo de entorno recuperable → failover (rotar proveedor) o retry.
 *   - resto → retry (nada lo frena).
 */
export function decideEscalation(i: EscalationInput): EscalationAction {
  if (i.fatal) return 'give_up';
  const heavy = (i.taskWeight ?? 0) >= 0.6;
  const half = Math.ceil(i.maxAttempts / 2);

  if (heavy && !i.swarmTried && i.attempt >= half) return 'swarm';

  if (i.attempt >= i.maxAttempts) {
    return heavy && !i.swarmTried ? 'swarm' : 'give_up';
  }

  if (i.failureMode) {
    if (FAILOVER_MODES.has(i.failureMode)) return 'failover';
    if (RETRY_MODES.has(i.failureMode)) return 'retry';
  }
  return 'retry';
}

/** Backoff exponencial determinista (sin jitter) con tope. */
export function backoffMs(attempt: number, baseMs = 200, capMs = 8000): number {
  const v = baseMs * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(capMs, Math.max(0, v));
}

/** Heurística de PESO de tarea 0..1: ¿hace falta el ejército? */
export function taskWeight(signals: { files?: number; loc?: number; subtasks?: number; repos?: number }): number {
  const f = (signals.files ?? 0) / 50;
  const l = (signals.loc ?? 0) / 5000;
  const s = (signals.subtasks ?? 0) / 5;
  const r = (signals.repos ?? 0) / 3;
  const w = Math.max(f, l, s, r);
  return w < 0 ? 0 : w > 1 ? 1 : w;
}

export interface RelentlessOptions<T> {
  /** Produce un intento (recibe el nº de intento). */
  work: (attempt: number) => Promise<T>;
  /** ¿El resultado cuenta como éxito? Default: no lanzar = éxito. */
  isSuccess?: (r: T) => boolean;
  /** Presupuesto de intentos (default 5). */
  maxAttempts?: number;
  /** Peso de la tarea 0..1 (taskWeight()). Pesada → escala al enjambre. */
  taskWeight?: number;
  /** Clasifica el error en un modo de entorno (inyecta classifyFailureMode). */
  classify?: (e: unknown) => string | null;
  /** ¿El error es fatal/irrecuperable? Corta en seco. */
  isFatal?: (e: unknown) => boolean;
  /** Rota de proveedor (failover). */
  onFailover?: () => void | Promise<void>;
  /** Acude al ejército: ejecuta el intento vía swarm/team. */
  onSwarm?: (attempt: number) => Promise<T>;
  /** El loop-detector externo puede frenar un bucle estéril (devuelve true). */
  onAbortSignal?: () => boolean;
  /** Espera inyectable (test sin esperas reales). */
  sleep?: (ms: number) => Promise<void>;
}

export interface RelentlessResult<T> {
  ok: boolean;
  value?: T;
  attempts: number;
  /** Se acudió al enjambre en algún momento. */
  escalatedToSwarm: boolean;
  /** Motivo si no se logró (honesto, nunca falso éxito). */
  gaveUpReason?: 'fatal' | 'agotado' | 'sin_exito' | 'loop_detector';
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Ejecuta una unidad de trabajo de forma RELENTLESS pero acotada. Persigue el
 * objetivo con reintentos/failover/escalada al enjambre; se detiene solo ante
 * fatal, agotamiento, o señal del loop-detector. Nunca finge éxito.
 */
export async function runRelentless<T>(o: RelentlessOptions<T>): Promise<RelentlessResult<T>> {
  const maxAttempts = Math.max(1, o.maxAttempts ?? 5);
  const sleep = o.sleep ?? defaultSleep;
  let swarmTried = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const r = swarmTried && o.onSwarm ? await o.onSwarm(attempt) : await o.work(attempt);
      const good = o.isSuccess ? o.isSuccess(r) : true;
      if (good) return { ok: true, value: r, attempts: attempt, escalatedToSwarm: swarmTried };
      // Produjo algo pero no cumple: trátalo como fallo lógico.
      const action = decideEscalation({ attempt, maxAttempts, taskWeight: o.taskWeight, swarmTried });
      if (action === 'give_up') return { ok: false, attempts: attempt, escalatedToSwarm: swarmTried, gaveUpReason: 'sin_exito' };
      if (action === 'swarm') swarmTried = true;
      else if (action === 'failover') await o.onFailover?.();
    } catch (e) {
      const fatal = o.isFatal?.(e) ?? false;
      const failureMode = o.classify?.(e) ?? null;
      const action = decideEscalation({ attempt, maxAttempts, failureMode, taskWeight: o.taskWeight, fatal, swarmTried });
      if (action === 'give_up') return { ok: false, attempts: attempt, escalatedToSwarm: swarmTried, gaveUpReason: fatal ? 'fatal' : 'agotado' };
      if (action === 'swarm') swarmTried = true;
      else if (action === 'failover') await o.onFailover?.();
    }

    // El candado de la disciplina: un bucle estéril se corta (loop-detector).
    if (o.onAbortSignal?.()) return { ok: false, attempts: attempt, escalatedToSwarm: swarmTried, gaveUpReason: 'loop_detector' };
    if (attempt < maxAttempts) await sleep(backoffMs(attempt));
  }

  return { ok: false, attempts: maxAttempts, escalatedToSwarm: swarmTried, gaveUpReason: 'agotado' };
}
