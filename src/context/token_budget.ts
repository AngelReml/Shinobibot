/**
 * Token Budget Tracker — observa cuántos tokens consume cada sesión y los
 * compara con el budget configurado, exponiendo eventos para la UI.
 *
 * Diseño:
 *   - Stateless tracker por sesión, identificado por sessionId.
 *   - Cada turno actualiza tokens usados (estimación) y emite snapshot
 *     `{ sessionId, usedTokens, budgetTokens, ratio, lastTurnAt }`.
 *   - Por defecto se mantiene en memoria; se puede dump a JSON snapshot
 *     para que el WebChat / TUI lo lea.
 *
 * Diferenciador: Hermes y OpenClaw ocultan token usage. Shinobi lo expone
 * en cada respuesta — trust signal grande.
 */

import { totalTokens } from './compactor.js';

export interface TokenSnapshot {
  sessionId: string;
  usedTokens: number;
  budgetTokens: number;
  /** usedTokens / budgetTokens, redondeado a 3 decimales. 0-1+. */
  ratio: number;
  lastTurnAt: string; // ISO8601
  turns: number;
}

export class TokenBudgetTracker {
  private readonly snapshots = new Map<string, TokenSnapshot>();
  private readonly defaultBudget: number;

  constructor(opts: { defaultBudget?: number } = {}) {
    this.defaultBudget = opts.defaultBudget ?? 32_000;
  }

  /**
   * Actualiza el conteo de tokens para una sesión a partir del array de
   * messages que se mandó al LLM. Devuelve el snapshot resultante.
   */
  recordTurn(sessionId: string, messages: unknown[]): TokenSnapshot {
    const used = totalTokens(messages as any[]);
    const budget = this.defaultBudget;
    const prev = this.snapshots.get(sessionId);
    const snap: TokenSnapshot = {
      sessionId,
      usedTokens: used,
      budgetTokens: budget,
      ratio: Math.round((used / budget) * 1000) / 1000,
      lastTurnAt: new Date().toISOString(),
      turns: (prev?.turns ?? 0) + 1,
    };
    this.snapshots.set(sessionId, snap);
    return snap;
  }

  /** Devuelve el snapshot actual o undefined si la sesión no existe. */
  get(sessionId: string): TokenSnapshot | undefined {
    const s = this.snapshots.get(sessionId);
    return s ? { ...s } : undefined;
  }

  /** Lista todas las sesiones activas. */
  list(): TokenSnapshot[] {
    return [...this.snapshots.values()].map(s => ({ ...s }));
  }

  /** Quita una sesión del tracker. */
  forget(sessionId: string): void {
    this.snapshots.delete(sessionId);
  }

  /** Devuelve true si la sesión está a >= warnRatio (default 0.85) del budget. */
  isNearCap(sessionId: string, warnRatio = 0.85): boolean {
    const s = this.snapshots.get(sessionId);
    if (!s) return false;
    return s.ratio >= warnRatio;
  }
}

/** Singleton de proceso — el WebChat y el orchestrator comparten instancia. */
let _global: TokenBudgetTracker | null = null;
export function tokenBudget(): TokenBudgetTracker {
  if (!_global) {
    const env = Number(process.env.SHINOBI_CONTEXT_BUDGET);
    _global = new TokenBudgetTracker({
      defaultBudget: Number.isFinite(env) && env > 0 ? env : 32_000,
    });
  }
  return _global;
}

/** Helper para reset en tests. */
export function _resetTokenBudget(): void {
  _global = null;
}
