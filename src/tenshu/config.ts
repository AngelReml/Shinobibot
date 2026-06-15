/**
 * tenshu/config.ts — feature flag. Tenshu (天守, the castle keep): the command
 * bridge over the whole dojo (VER/CONDUCIR/ENTENDER/CONSULTAR). Additive, gated by
 * TENSHU_ENABLED (default off). Golden rule: it REFLECTS, never narrates — what you
 * see is the real store + verifiable traces, not a summary the agent invents. A
 * command bridge that lies is worse than the NES controller.
 */
export function tenshuEnabled(): boolean {
  const v = (process.env.TENSHU_ENABLED ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}
