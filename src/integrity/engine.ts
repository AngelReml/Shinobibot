// src/integrity/engine.ts
//
// Integrity layer (Capa 2) — checks pre/post-action (claimed==real) y bloqueo opcional vía SHINOBI_INTEGRITY.
/**
 * integrity/engine.ts — runtime integrity layer (Capa 2), increment C1.
 *
 * Aggregates the pre-action checks (11.1 + 11.2) into a verdict and applies
 * policy. Hooks into the agent loop are ADDITIVE and gated by SHINOBI_INTEGRITY:
 *   off     (default) → layer is a no-op; production behaviour unchanged.
 *   flag             → run checks, record violations, but never block.
 *   enforce          → block (halt) the action on any violation.
 * Policy also blocks on high-risk context regardless of mode (dossier 11.x).
 *
 * The post-action hook exists as a seam (for 11.4 in a later increment) and runs
 * no checks yet.
 */

import { check11_1, check11_2, check11_3, check11_4 } from './checks.js';
import type { CheckResult, IntegrityStep, IntegrityFlag, IntegrityVerdict, PostActionInput } from './types.js';

export type IntegrityMode = 'off' | 'flag' | 'enforce';

export function integrityMode(): IntegrityMode {
  // FIX 0.14: default 'flag' (detecta y registra, no bloquea).
  // 'off' solo se activa con SHINOBI_INTEGRITY=off explícito.
  const m = (process.env.SHINOBI_INTEGRITY ?? 'flag').toLowerCase();
  if (m === 'off') return 'off';
  return m === 'enforce' ? 'enforce' : 'flag';
}

export function integrityEnabled(): boolean {
  return integrityMode() !== 'off';
}

/** Run the C1 pre-action checks and decide proceed/flag/halt. */
export function runPreAction(step: IntegrityStep): IntegrityVerdict {
  const t0 = performance.now();
  const checks: CheckResult[] = [check11_1(step), check11_2(step), check11_3(step)];
  const durationMs = performance.now() - t0;

  const failed = checks.filter((c) => !c.ok);
  const flags = failed.map((c) => c.flag).filter(Boolean) as IntegrityFlag[];
  const ok = failed.length === 0;

  const mode = integrityMode();
  let action: IntegrityVerdict['action'] = 'proceed';
  if (!ok) action = (mode === 'enforce' || step.risk === 'high') ? 'halt' : 'flag';

  return { ok, action, checks, flags, durationMs };
}

/** Run the C2 post-action check 11.4 (reported == real) and decide proceed/flag/halt. */
export function runPostAction(input: PostActionInput): IntegrityVerdict {
  const t0 = performance.now();
  const checks: CheckResult[] = [check11_4(input)];
  const durationMs = performance.now() - t0;

  const failed = checks.filter((c) => !c.ok);
  const flags = failed.map((c) => c.flag).filter(Boolean) as IntegrityFlag[];
  const ok = failed.length === 0;

  const mode = integrityMode();
  let action: IntegrityVerdict['action'] = 'proceed';
  if (!ok) action = (mode === 'enforce' || input.risk === 'high') ? 'halt' : 'flag';

  return { ok, action, checks, flags, durationMs };
}

/** Heuristic: does an agent's report text claim success/completion? (the
 *  inherently fuzzy "reported" side of 11.4; the real side is deterministic). */
const SUCCESS_CLAIM = /\b(completad[oa]s?|hecho|realizad[oa]s?|con éxito|exitos[oa]s?|success(ful)?|done|listo|terminad[oa]s?|finalizad[oa]s?|transferenci[ao] (completad|realizad))\b|✅/i;
export function reportClaimsSuccess(reportText: string): boolean {
  return SUCCESS_CLAIM.test(reportText ?? '');
}
