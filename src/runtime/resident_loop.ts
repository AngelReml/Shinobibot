import { MissionsStore, type RecurrentMission } from '../persistence/missions_recurrent.js';
import { Notifier } from '../notifications/notifier.js';
import { ShinobiOrchestrator } from '../coordinator/orchestrator.js';

/**
 * Corre `p` con un límite de tiempo. Si `p` no resuelve en `ms`, la promesa
 * devuelta rechaza con un error de timeout. NOTA: las promesas JS no son
 * cancelables — `p` sigue ejecutándose en segundo plano; lo que se logra es
 * DESBLOQUEAR al caller (el resident loop no se cuelga por una misión colgada).
 * Exportada para poder validarla con ejecución real.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: timeout tras ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export interface ResidentLoopOptions {
  /** Intervalo base entre ticks (ms). Default 30s o SHINOBI_RESIDENT_TICK_MS. */
  tickIntervalMs?: number;
  /** Límite por misión (ms). Default 10min o SHINOBI_MISSION_TIMEOUT_MS. */
  missionTimeoutMs?: number;
}

export class ResidentLoop {
  private store: MissionsStore;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly tickIntervalMs: number;
  private readonly missionTimeoutMs: number;
  /** Ticks fallidos consecutivos — alimenta el backoff exponencial. */
  private consecutiveTickFailures = 0;

  constructor(store?: MissionsStore, opts: ResidentLoopOptions = {}) {
    this.store = store || new MissionsStore();
    this.tickIntervalMs = opts.tickIntervalMs
      ?? (Number(process.env.SHINOBI_RESIDENT_TICK_MS) || 30000);
    this.missionTimeoutMs = opts.missionTimeoutMs
      ?? (Number(process.env.SHINOBI_MISSION_TIMEOUT_MS) || 600000);
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    console.log('[ResidentLoop] started. Tick interval: ' + (this.tickIntervalMs / 1000) + 's');
    this.scheduleNext();
  }

  public stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    console.log('[ResidentLoop] stopped.');
  }

  public isRunning(): boolean { return this.running; }

  private scheduleNext(): void {
    if (!this.running) return;
    // Backoff exponencial: si los ticks fallan en cadena (p.ej. DB corrupta),
    // el intervalo crece (cap x16) en vez de spammear cada 30s para siempre.
    const backoff = Math.min(2 ** this.consecutiveTickFailures, 16);
    const delay = this.tickIntervalMs * backoff;
    this.timer = setTimeout(async () => {
      try {
        await this.tick();
        this.consecutiveTickFailures = 0;
      } catch (e: any) {
        this.consecutiveTickFailures++;
        console.error(`[ResidentLoop] tick error (#${this.consecutiveTickFailures}, backoff x${backoff}):`, e?.message ?? e);
        if (this.consecutiveTickFailures === 3) {
          try {
            await Notifier.send({
              level: 'error',
              title: 'ResidentLoop: 3 ticks fallidos consecutivos',
              body: `El loop residente no puede procesar misiones. Último error: ${String(e?.message ?? e).slice(0, 400)}`,
              context: {},
            });
          } catch { /* notifier best-effort */ }
        }
      }
      this.scheduleNext();
    }, delay);
  }

  private async tick(): Promise<void> {
    const due = this.store.getDueMissions();
    if (due.length === 0) return;
    for (const m of due) {
      await this.runMission(m);
    }
  }

  private async runMission(m: RecurrentMission): Promise<void> {
    console.log(`[ResidentLoop] running mission ${m.id} (${m.name})`);
    try {
      // withTimeout: una misión colgada no bloquea el resto del loop.
      const result = await withTimeout(
        ShinobiOrchestrator.process(m.prompt),
        this.missionTimeoutMs,
        `mission ${m.id}`,
      );
      const outputStr = typeof result === 'string' ? result : JSON.stringify(result);
      this.store.recordRun(m.id, 'success', outputStr);
      console.log(`[ResidentLoop] mission ${m.id} OK`);
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      this.store.recordRun(m.id, 'failure', null, errMsg);
      console.error(`[ResidentLoop] mission ${m.id} FAILED: ${errMsg}`);

      const updated = this.store.get(m.id);
      if (updated && updated.consecutive_failures === 3) {
        await Notifier.send({
          level: 'error',
          title: `Mission "${m.name}" disabled after 3 failures`,
          body: `Last error: ${errMsg.substring(0, 500)}`,
          context: { mission_id: m.id }
        });
      }
    }
  }

  public getStore(): MissionsStore { return this.store; }
}
