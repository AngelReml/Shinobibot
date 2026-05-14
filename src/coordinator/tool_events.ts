/**
 * Tool Execution Events — EventEmitter singleton para que el WebChat (y
 * cualquier otro subscriptor) reciba feedback en tiempo real sobre la
 * ejecución de tools, sin acoplar el orchestrator al transporte.
 *
 * Tipos de eventos:
 *
 *   tool_started   { tool, argsPreview }  — antes de tool.execute()
 *   tool_completed { tool, success, durationMs, errorPreview? } — tras execute()
 *
 * Diseño:
 *   - Singleton de proceso (1 emitter compartido).
 *   - El orchestrator emite; quien escuche se suscribe (server.ts → WS,
 *     TUI → render, audit → backup adicional).
 *   - El emitter NO bloquea: si un listener lanza, lo absorbe.
 *   - argsPreview / errorPreview truncados a 200 chars para no inundar
 *     la UI con tool outputs gigantes.
 *
 * Diferenciador: Hermes notifica resultados solo al final del loop;
 * OpenClaw tiene `pi-embedded-runner` con turnos visibles. Shinobi
 * expone CADA tool individual mientras se ejecuta — el WebChat con
 * typewriter ya animado puede mostrar "🔨 run_command ejecutándose…"
 * en tiempo real.
 */

import { EventEmitter } from 'events';

export type ToolEventKind = 'tool_started' | 'tool_completed';

export interface ToolStartedEvent {
  kind: 'tool_started';
  ts: string;
  tool: string;
  argsPreview: string;
  sessionId?: string;
}

export interface ToolCompletedEvent {
  kind: 'tool_completed';
  ts: string;
  tool: string;
  success: boolean;
  durationMs: number;
  errorPreview?: string;
  sessionId?: string;
}

export type ToolEvent = ToolStartedEvent | ToolCompletedEvent;

const PREVIEW_CAP = 200;

function preview(value: unknown): string {
  let s: string;
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (!s) return '';
  if (s.length > PREVIEW_CAP) s = s.slice(0, PREVIEW_CAP) + '…';
  return s;
}

class ToolEventBus extends EventEmitter {
  constructor() {
    super();
    // Permite muchos listeners (server WS + TUI + audit backup) sin warning.
    this.setMaxListeners(50);
  }

  emitToolStarted(args: { tool: string; args: unknown; sessionId?: string }): void {
    const event: ToolStartedEvent = {
      kind: 'tool_started',
      ts: new Date().toISOString(),
      tool: args.tool,
      argsPreview: preview(args.args),
      sessionId: args.sessionId,
    };
    this.safeEmit('tool_event', event);
    this.safeEmit('tool_started', event);
  }

  emitToolCompleted(args: {
    tool: string;
    success: boolean;
    durationMs: number;
    error?: string;
    sessionId?: string;
  }): void {
    const event: ToolCompletedEvent = {
      kind: 'tool_completed',
      ts: new Date().toISOString(),
      tool: args.tool,
      success: args.success,
      durationMs: Math.max(0, Math.round(args.durationMs)),
      errorPreview: args.error ? preview(args.error) : undefined,
      sessionId: args.sessionId,
    };
    this.safeEmit('tool_event', event);
    this.safeEmit('tool_completed', event);
  }

  /**
   * Versión `emit` que captura excepciones de listeners para que un
   * subscriber roto no tumbe el orchestrator.
   */
  private safeEmit(name: string, event: ToolEvent): void {
    try {
      super.emit(name, event);
    } catch {
      // listener lanzó — ignorar; el agente sigue.
    }
  }
}

let _bus: ToolEventBus | null = null;

export function toolEvents(): ToolEventBus {
  if (!_bus) _bus = new ToolEventBus();
  return _bus;
}

/** Reset para tests. */
export function _resetToolEvents(): void {
  if (_bus) _bus.removeAllListeners();
  _bus = null;
}
