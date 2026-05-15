/**
 * Failover cooldown — Sprint P2.3 (paridad OpenClaw auth-profiles).
 *
 * Cuando un (provider, auth-profile) recibe 429/transient repetido, en
 * vez de reintentar inmediatamente ponemos esa key en cooldown N segundos
 * + lanzamos un probe ligero cada `cooldown/3` para detectar si volvió.
 *
 * El cooldown NO sustituye a la rotación cross-provider del failover.ts
 * existente; es una capa ortogonal que decide CUÁNDO se puede volver a
 * usar una key específica.
 *
 * Estructura:
 *   - `markFailure(profile, errorClass)` actualiza estadísticas + abre
 *     cooldown si el error es 'rate_limit' o 'transient' y la racha
 *     supera `failureThreshold`.
 *   - `markSuccess(profile)` resetea racha y termina cooldown si estaba.
 *   - `isAvailable(profile)` → false si está en cooldown activo.
 *   - `nextRetryAt(profile)` → timestamp para probe.
 *   - `metrics()` → para `/admin/metrics`.
 */

export type AuthProfileId = string; // formato: `<provider>/<keyAlias>`

export type CooldownTrigger = 'rate_limit' | 'transient' | 'auth';

export interface CooldownConfig {
  /** Segundos de cooldown base tras racha completa (default 60s). */
  baseCooldownSec?: number;
  /** Failures consecutivos antes de abrir cooldown (default 3). */
  failureThreshold?: number;
  /** Multiplicador exponencial por re-aperturas (default 2). */
  backoffMultiplier?: number;
  /** Cooldown máximo (default 600s = 10min). */
  maxCooldownSec?: number;
  /** Función now() inyectable para tests. */
  nowFn?: () => number;
}

export interface ProfileState {
  failureStreak: number;
  reopenCount: number;
  lastFailureAt: number | null;
  cooldownUntil: number | null;
  totalFailures: number;
  totalSuccesses: number;
}

const DEFAULTS: Required<Omit<CooldownConfig, 'nowFn'>> = {
  baseCooldownSec: 60,
  failureThreshold: 3,
  backoffMultiplier: 2,
  maxCooldownSec: 600,
};

export class FailoverCooldown {
  private states = new Map<AuthProfileId, ProfileState>();
  private cfg: Required<Omit<CooldownConfig, 'nowFn'>>;
  private now: () => number;

  constructor(opts: CooldownConfig = {}) {
    this.cfg = {
      baseCooldownSec: opts.baseCooldownSec ?? DEFAULTS.baseCooldownSec,
      failureThreshold: opts.failureThreshold ?? DEFAULTS.failureThreshold,
      backoffMultiplier: opts.backoffMultiplier ?? DEFAULTS.backoffMultiplier,
      maxCooldownSec: opts.maxCooldownSec ?? DEFAULTS.maxCooldownSec,
    };
    this.now = opts.nowFn ?? (() => Date.now());
  }

  private getState(profile: AuthProfileId): ProfileState {
    let s = this.states.get(profile);
    if (!s) {
      s = {
        failureStreak: 0,
        reopenCount: 0,
        lastFailureAt: null,
        cooldownUntil: null,
        totalFailures: 0,
        totalSuccesses: 0,
      };
      this.states.set(profile, s);
    }
    return s;
  }

  /**
   * Registra un fallo. Si supera threshold y trigger es relevante,
   * abre cooldown con backoff exponencial.
   */
  markFailure(profile: AuthProfileId, trigger: CooldownTrigger): {
    cooldownOpened: boolean;
    cooldownSec: number;
  } {
    const s = this.getState(profile);
    const t = this.now();
    s.failureStreak++;
    s.lastFailureAt = t;
    s.totalFailures++;

    const shouldOpen =
      (trigger === 'rate_limit' || trigger === 'transient' || trigger === 'auth') &&
      s.failureStreak >= this.cfg.failureThreshold;

    if (!shouldOpen) {
      return { cooldownOpened: false, cooldownSec: 0 };
    }

    const cooldownSec = Math.min(
      this.cfg.baseCooldownSec * Math.pow(this.cfg.backoffMultiplier, s.reopenCount),
      this.cfg.maxCooldownSec
    );
    s.cooldownUntil = t + cooldownSec * 1000;
    s.reopenCount++;
    return { cooldownOpened: true, cooldownSec };
  }

  /** Registra un éxito. Resetea racha y termina cooldown. */
  markSuccess(profile: AuthProfileId): void {
    const s = this.getState(profile);
    s.failureStreak = 0;
    s.cooldownUntil = null;
    s.totalSuccesses++;
    // reopenCount NO se resetea; sirve para acumular backoff entre rachas.
  }

  /** True si el profile puede usarse ahora. */
  isAvailable(profile: AuthProfileId): boolean {
    const s = this.states.get(profile);
    if (!s || s.cooldownUntil === null) return true;
    return this.now() >= s.cooldownUntil;
  }

  /**
   * Cuándo lanzar el probe: cooldownUntil - (cooldownTotal * 2/3) =
   * 1/3 del cooldown restante. null si no está en cooldown.
   */
  nextRetryAt(profile: AuthProfileId): number | null {
    const s = this.states.get(profile);
    if (!s?.cooldownUntil) return null;
    const remaining = s.cooldownUntil - this.now();
    if (remaining <= 0) return this.now();
    return this.now() + Math.floor(remaining / 3);
  }

  /** Snapshot de todas las profiles. */
  metrics(): Array<{
    profile: AuthProfileId;
    available: boolean;
    failureStreak: number;
    totalFailures: number;
    totalSuccesses: number;
    cooldownUntil: number | null;
    reopenCount: number;
  }> {
    return Array.from(this.states.entries()).map(([profile, s]) => ({
      profile,
      available: this.isAvailable(profile),
      failureStreak: s.failureStreak,
      totalFailures: s.totalFailures,
      totalSuccesses: s.totalSuccesses,
      cooldownUntil: s.cooldownUntil,
      reopenCount: s.reopenCount,
    }));
  }

  /** Test helper: limpia todo. */
  _resetForTests(): void {
    this.states.clear();
  }
}
