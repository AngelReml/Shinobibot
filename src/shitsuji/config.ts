/**
 * shitsuji/config.ts — feature flag. Shitsuji (執事, the butler): Level-5, the
 * dojo's peak. Turns natural-language will into act by composing CERTIFIED skills
 * over the user's REAL data. Additive, gated by SHITSUJI_ENABLED (default off).
 * It does NOT improvise on your real world: it composes what Shugyō certified,
 * checks it can before touching anything, and never says "done" if it isn't. ⚑
 */
export function shitsujiEnabled(): boolean {
  const v = (process.env.SHITSUJI_ENABLED ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}
