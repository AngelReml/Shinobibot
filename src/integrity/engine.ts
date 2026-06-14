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

import { check11_1, check11_2 } from './checks.js';
import type { CheckResult, IntegrityStep, IntegrityFlag, IntegrityVerdict } from './types.js';

export type IntegrityMode = 'off' | 'flag' | 'enforce';

export function integrityMode(): IntegrityMode {
  const m = (process.env.SHINOBI_INTEGRITY ?? 'off').toLowerCase();
  return m === 'flag' || m === 'enforce' ? m : 'off';
}

export function integrityEnabled(): boolean {
  return integrityMode() !== 'off';
}

/** Run the C1 pre-action checks and decide proceed/flag/halt. */
export function runPreAction(step: IntegrityStep): IntegrityVerdict {
  const t0 = performance.now();
  const checks: CheckResult[] = [check11_1(step), check11_2(step)];
  const durationMs = performance.now() - t0;

  const failed = checks.filter((c) => !c.ok);
  const flags = failed.map((c) => c.flag).filter(Boolean) as IntegrityFlag[];
  const ok = failed.length === 0;

  const mode = integrityMode();
  let action: IntegrityVerdict['action'] = 'proceed';
  if (!ok) action = (mode === 'enforce' || step.risk === 'high') ? 'halt' : 'flag';

  return { ok, action, checks, flags, durationMs };
}

/** Post-action hook seam — no checks in C1 (11.4 lands later). */
export function runPostAction(_step: IntegrityStep, _result: unknown): IntegrityVerdict {
  return { ok: true, action: 'proceed', checks: [], flags: [], durationMs: 0 };
}
