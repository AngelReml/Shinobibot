/**
 * chizu/config.ts — feature flag. Chizu (地図, the map): Level-3, the cartographer
 * that recognizes the terrain before stepping on it. Additive, gated by
 * CHIZU_ENABLED (default off). Golden rule: the map contains ONLY what it verified
 * to exist — it never invents a street it didn't walk.
 */
export function chizuEnabled(): boolean {
  const v = (process.env.CHIZU_ENABLED ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}
