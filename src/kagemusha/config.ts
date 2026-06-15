/**
 * kagemusha/config.ts — feature flag + global knobs.
 *
 * Kagemusha (影武者, the shadow-double): the Level-1 subsystem that runs an
 * autonomous night mission and produces a Dawn Report you can trust because
 * integrity (Capa 2) was on while it worked. Everything here is ADDITIVE and
 * gated by KAGEMUSHA_ENABLED (default off) — turning it on must not change
 * Shinobi's production loop, and the existing test suite stays green untouched.
 */

export function kagemushaEnabled(): boolean {
  const v = (process.env.KAGEMUSHA_ENABLED ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}

/** Per-phase model selection (dossier §12.3): cheap for bulk, strong for judgment. */
export function bulkModel(): string {
  return process.env.KAGEMUSHA_BULK_MODEL || 'glm-4-flash';
}
export function judgeModel(): string {
  // Empty → let the provider router use the session default (strong) model.
  return process.env.KAGEMUSHA_JUDGE_MODEL || '';
}
