/**
 * E5 — registro de apuestas con calibración asimétrica.
 *
 * Regla de calibración (PLAN_SOMBRA §E5):
 *   WIN     → +1.0  (apostaste y acertaste)
 *   PARTIAL → +0.3  (parcialmente correcto)
 *   MISS    → -2.0  (perdiste la tendencia; penaliza el doble)
 *
 * Por qué asimétrico: la ventaja de Shinobi es apostar TEMPRANO.
 * Perderse una tendencia real cuesta más que perseguir una falsa.
 * Ningún comité puede permitirse este sesgo; un solo operador que
 * decide rápido puede asumir el riesgo calibrado.
 *
 * Persistencia: JSON en data/sentinel/bets.json.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { createHash } from 'crypto';
import type { E5Bet, E5Hypothesis } from './e5_types.js';

const SCORES: Record<'WIN' | 'MISS' | 'PARTIAL', number> = {
  WIN:     +1.0,
  PARTIAL: +0.3,
  MISS:    -2.0,
};

export class E5BetRegistry {
  private bets: Map<string, E5Bet> = new Map();

  constructor(private readonly storePath: string) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.storePath)) return;
    try {
      const arr = JSON.parse(readFileSync(this.storePath, 'utf-8')) as E5Bet[];
      for (const b of arr) this.bets.set(b.betId, b);
    } catch { /* fichero corrupto — arranca vacío */ }
  }

  private save(): void {
    mkdirSync(dirname(this.storePath), { recursive: true });
    writeFileSync(this.storePath, JSON.stringify([...this.bets.values()], null, 2), 'utf-8');
  }

  /** Registra una apuesta sobre una hipótesis aprobada por el operador. */
  register(h: E5Hypothesis): E5Bet {
    const betId = 'bet_' + createHash('sha256')
      .update(h.hypothesisId + Date.now())
      .digest('hex').slice(0, 10);
    const bet: E5Bet = {
      betId,
      hypothesisId: h.hypothesisId,
      title: h.title,
      dimension: h.dimension,
      credibilityAtBet: h.credibility,
      registeredAt: new Date().toISOString(),
      outcome: null,
      resolvedAt: null,
      calibrationScore: null,
    };
    this.bets.set(betId, bet);
    this.save();
    return bet;
  }

  /** Registra el resultado de una apuesta. */
  resolve(betId: string, outcome: 'WIN' | 'MISS' | 'PARTIAL'): E5Bet {
    const bet = this.bets.get(betId);
    if (!bet) throw new Error(`apuesta ${betId} no encontrada`);
    if (bet.outcome !== null) throw new Error(`apuesta ${betId} ya está resuelta (${bet.outcome})`);
    const updated: E5Bet = {
      ...bet,
      outcome,
      resolvedAt: new Date().toISOString(),
      calibrationScore: SCORES[outcome],
    };
    this.bets.set(betId, updated);
    this.save();
    return updated;
  }

  /** Apuestas pendientes de resultado. */
  pending(): E5Bet[] {
    return [...this.bets.values()].filter((b) => b.outcome === null);
  }

  /** Apuestas ya resueltas. */
  resolved(): E5Bet[] {
    return [...this.bets.values()].filter((b) => b.outcome !== null);
  }

  /**
   * Puntuación de calibración acumulada.
   * > 0 → el operador apuesta con buen criterio.
   * < 0 → se están perdiendo más tendencias de las que se persiguen en falso.
   */
  calibrationScore(): number {
    const done = this.resolved();
    if (done.length === 0) return 0;
    return done.reduce((s, b) => s + (b.calibrationScore ?? 0), 0);
  }

  getById(betId: string): E5Bet | undefined {
    return this.bets.get(betId);
  }

  all(): E5Bet[] {
    return [...this.bets.values()];
  }
}
