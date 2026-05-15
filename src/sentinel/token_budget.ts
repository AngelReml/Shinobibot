/**
 * Sentinel token budget — límite duro semanal.
 *
 * Si el consumo acumulado en la ventana semanal cruza
 * `SHINOBI_SENTINEL_TOKEN_BUDGET` (default 50_000), el watcher pausa
 * hasta la siguiente ventana.
 *
 * Estado persistido en JSON: { windowStart, tokensUsed }.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_BUDGET = 50_000;

export interface BudgetState {
  /** ISO del inicio de la ventana semanal actual. */
  windowStart: string;
  /** Tokens consumidos en la ventana. */
  tokensUsed: number;
}

export interface BudgetOptions {
  /** Path del JSON de estado. */
  statePath: string;
  /** Límite; default lee SHINOBI_SENTINEL_TOKEN_BUDGET o 50k. */
  budget?: number;
  /** now() inyectable para tests. */
  nowFn?: () => number;
}

export class SentinelTokenBudget {
  private statePath: string;
  private budget: number;
  private now: () => number;

  constructor(opts: BudgetOptions) {
    this.statePath = opts.statePath;
    const envBudget = Number(process.env.SHINOBI_SENTINEL_TOKEN_BUDGET);
    this.budget = opts.budget
      ?? (Number.isFinite(envBudget) && envBudget > 0 ? envBudget : DEFAULT_BUDGET);
    this.now = opts.nowFn ?? (() => Date.now());
  }

  get limit(): number { return this.budget; }

  private load(): BudgetState {
    if (!existsSync(this.statePath)) {
      return { windowStart: new Date(this.now()).toISOString(), tokensUsed: 0 };
    }
    try {
      const s = JSON.parse(readFileSync(this.statePath, 'utf-8')) as BudgetState;
      if (typeof s.windowStart === 'string' && typeof s.tokensUsed === 'number') return s;
    } catch { /* fall through */ }
    return { windowStart: new Date(this.now()).toISOString(), tokensUsed: 0 };
  }

  private save(s: BudgetState): void {
    mkdirSync(dirname(this.statePath), { recursive: true });
    writeFileSync(this.statePath, JSON.stringify(s, null, 2), 'utf-8');
  }

  /** Rota la ventana si ya pasó una semana. */
  private rolled(s: BudgetState): BudgetState {
    const elapsed = this.now() - new Date(s.windowStart).getTime();
    if (elapsed >= WEEK_MS) {
      return { windowStart: new Date(this.now()).toISOString(), tokensUsed: 0 };
    }
    return s;
  }

  /** Estado actual (con rotación aplicada). */
  state(): BudgetState {
    return this.rolled(this.load());
  }

  /** Tokens restantes en la ventana. */
  remaining(): number {
    return Math.max(0, this.budget - this.state().tokensUsed);
  }

  /** True si el watcher puede seguir consumiendo. */
  canProceed(): boolean {
    return this.remaining() > 0;
  }

  /** Registra consumo. Devuelve el estado tras el cargo. */
  consume(tokens: number): BudgetState {
    const s = this.rolled(this.load());
    s.tokensUsed += Math.max(0, Math.round(tokens));
    this.save(s);
    return s;
  }

  /** Test helper: fuerza un estado. */
  _setForTests(s: BudgetState): void {
    this.save(s);
  }
}
