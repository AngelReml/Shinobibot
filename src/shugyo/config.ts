/**
 * shugyo/config.ts — feature flag. Shugyō (修行, disciplined training to master an
 * art): Level-4, the explorer that learns to operate the programs Chizu mapped, in
 * a revertible cage, distilling certified skills via Sello. Additive, gated by
 * SHUGYO_ENABLED (default off). Train program by program, the docile ones first.
 * ◆ canvas/vision is out of v1 scope (honest frontier).
 */
export function shugyoEnabled(): boolean {
  const v = (process.env.SHUGYO_ENABLED ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}
