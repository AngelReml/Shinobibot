/**
 * Channel Registry — singleton que mantiene la lista de adaptadores
 * registrados y orquesta su ciclo de vida.
 *
 * Responsabilidades:
 *
 *  - Permitir a cada adaptador registrarse al inicializarse el módulo.
 *  - Iniciar solo los adaptadores que `isConfigured()` devuelve true.
 *  - Despachar el `MessageHandler` único del orchestrator a cada uno.
 *  - Apagado limpio coordinado en `shutdown()`.
 *  - Diagnóstico vía `summary()`.
 *
 * Diseño deliberado: el orchestrator NO conoce los canales. Solo
 * registra su handler una vez (`bindHandler`) y el registry hace el
 * fan-out a todos los adaptadores activos.
 */

import type { ChannelAdapter, ChannelId, IncomingMessage, MessageHandler, OutgoingMessage, ChannelTarget } from './types.js';

class ChannelRegistry {
  private readonly adapters = new Map<ChannelId, ChannelAdapter>();
  private handler: MessageHandler | null = null;
  private started = false;

  /** Registra un adaptador. Llamado por cada `<channel>_adapter.ts`. */
  register(adapter: ChannelAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Channel adapter '${adapter.id}' ya está registrado`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  /** Útil para tests: desregistra todos los adaptadores. */
  reset(): void {
    this.adapters.clear();
    this.handler = null;
    this.started = false;
  }

  list(): ChannelAdapter[] {
    return [...this.adapters.values()];
  }

  get(id: ChannelId): ChannelAdapter | undefined {
    return this.adapters.get(id);
  }

  /** Vincula el handler que recibe TODOS los mensajes entrantes. */
  bindHandler(handler: MessageHandler): void {
    this.handler = handler;
  }

  /**
   * Arranca todos los adaptadores configurados. Los que no lo estén se
   * skipean silenciosamente (`isConfigured() === false`).
   *
   * Devuelve un resumen de qué se arrancó y qué falló.
   */
  async start(): Promise<{ started: ChannelId[]; skipped: ChannelId[]; errors: Array<{ id: ChannelId; error: string }> }> {
    if (!this.handler) {
      throw new Error('ChannelRegistry.bindHandler() debe llamarse antes de start()');
    }
    const started: ChannelId[] = [];
    const skipped: ChannelId[] = [];
    const errors: Array<{ id: ChannelId; error: string }> = [];

    for (const adapter of this.adapters.values()) {
      if (!adapter.isConfigured()) {
        skipped.push(adapter.id);
        continue;
      }
      try {
        await adapter.start(this.handler);
        started.push(adapter.id);
      } catch (e: any) {
        errors.push({ id: adapter.id, error: e?.message ?? String(e) });
      }
    }
    this.started = true;
    return { started, skipped, errors };
  }

  /** Apagado coordinado. Best-effort: si uno falla, intenta los demás. */
  async shutdown(): Promise<void> {
    const tasks = [...this.adapters.values()].map(a => a.stop().catch(() => { /* swallow */ }));
    await Promise.all(tasks);
    this.started = false;
  }

  /** Snapshot legible para `/channels` o logs. */
  summary(): Array<{ id: ChannelId; label: string; configured: boolean; requires: string[]; running: boolean; received: number; sent: number; error?: string }> {
    return [...this.adapters.values()].map(a => {
      const s = a.status();
      return {
        id: a.id,
        label: a.label,
        configured: a.isConfigured(),
        requires: a.requiredEnvVars(),
        running: s.running,
        received: s.receivedCount,
        sent: s.sentCount,
        error: s.lastError,
      };
    });
  }

  /**
   * Envío proactivo: el orchestrator quiere mandar un mensaje sin que
   * haya un incoming previo. El registry localiza el adaptador correcto
   * y delega.
   */
  async send(target: ChannelTarget, msg: OutgoingMessage): Promise<void> {
    const a = this.adapters.get(target.channelId);
    if (!a) throw new Error(`No hay adaptador registrado para canal '${target.channelId}'`);
    if (!a.isConfigured()) throw new Error(`Adaptador '${target.channelId}' no está configurado (faltan env: ${a.requiredEnvVars().join(', ')})`);
    await a.send(target, msg);
  }
}

let _instance: ChannelRegistry | null = null;

export function channelRegistry(): ChannelRegistry {
  if (!_instance) _instance = new ChannelRegistry();
  return _instance;
}

/** Reset para tests. */
export function _resetChannelRegistry(): void {
  if (_instance) _instance.reset();
  _instance = null;
}

export type { IncomingMessage, MessageHandler, OutgoingMessage, ChannelTarget };
