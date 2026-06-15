/**
 * kangeiko/config.ts — feature flag. Kangeiko (寒稽古, intensive cold-weather
 * training): the verified self-improvement engine. Shinobi measuring itself,
 * filling its gaps, and getting more capable — alone, in a loop, on the VPS.
 * Additive, gated by KANGEIKO_ENABLED (default off). The metric is a curve that
 * rises, impossible to fake because every rung is CERTIFIED: self-improvement
 * proven, not claimed.
 */
export function kangeikoEnabled(): boolean {
  const v = (process.env.KANGEIKO_ENABLED ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}
