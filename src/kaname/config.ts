/**
 * kaname/config.ts — flag del subsistema Kaname (要), el núcleo inmutable y la
 * frontera núcleo/skills. Aditivo y gated (default off): designar y enforcear la
 * frontera no cambia el comportamiento de producción hasta que se activa.
 */

export function kanameEnabled(): boolean {
  const v = (process.env.KANAME_ENABLED ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}
