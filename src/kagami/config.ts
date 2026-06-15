/**
 * kagami/config.ts — feature flag. Kagami (鏡, the mirror): Level-2, Shinobi
 * knowing/guarding/improving itself with honesty. Additive, gated by
 * KAGAMI_ENABLED (default off). The mirror neither flatters nor diminishes.
 */
export function kagamiEnabled(): boolean {
  const v = (process.env.KAGAMI_ENABLED ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}
