/**
 * shugyo/config.ts — feature flag. Shugyō (修行, disciplined training to master an
 * art): Level-4, the explorer that learns to operate the programs Chizu mapped, in
 * a revertible cage, distilling certified skills via Sello. Additive, gated by
 * SHUGYO_ENABLED (default off). Train program by program, the docile ones first.
 * ◆ canvas/vision is out of v1 scope (honest frontier).
 *
 * "Revertible cage" = directory snapshot/restore (fs.cpSync + SHA-256), NOT an
 * OS/process sandbox — execution reuses the plain shell backend, unisolated. See
 * the full honesty note in shugyo/index.ts and shugyo/sandbox/revertible.ts (F2.13).
 */
export function shugyoEnabled(): boolean {
  const v = (process.env.SHUGYO_ENABLED ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}
