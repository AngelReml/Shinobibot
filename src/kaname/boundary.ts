/**
 * kaname/boundary.ts — KN-01: designar el núcleo y enforcear la frontera de imports.
 * No mueve código: DESIGNA qué módulos son Kaname (núcleo) y cuáles userspace, y
 * provee el linter que marca toda dependencia que cruce mal. Las dos reglas duras:
 *   - userspace NO importa el núcleo directamente (solo a través del contrato);
 *   - el núcleo NO importa userspace (lo que muta no puede ser dependencia del suelo).
 * El contrato (src/kaname) puede importar ambos lados — es el puente mediado.
 */

export type Zone = 'core' | 'userspace' | 'contract' | 'external';

/** Módulos designados NÚCLEO (sagrado, inmutable) — §3/§4. */
export const CORE_PATHS = [
  'src/agents/agent_loop', 'src/integrity', 'src/coordinator', 'src/tenshu',
  'src/providers', 'src/sandbox', 'src/security/approval', 'src/cloud',
];
/** El contrato/frontera. */
export const CONTRACT_PATHS = ['src/kaname'];
/** Módulos designados USERSPACE (mutable, lo que el enjambre puede generar) — §3. */
export const USERSPACE_PATHS = [
  'src/shugyo', 'src/kangeiko', 'src/chizu', 'src/kagemusha', 'src/skills', 'src/memory',
];

const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '');

/** Classify a module path into its zone (longest-prefix wins; contract beats core). */
export function classifyZone(path: string): Zone {
  const p = norm(path);
  if (CONTRACT_PATHS.some((c) => p.startsWith(c))) return 'contract';
  if (CORE_PATHS.some((c) => p.startsWith(c))) return 'core';
  if (USERSPACE_PATHS.some((c) => p.startsWith(c))) return 'userspace';
  return 'external';
}

export interface ImportEdge { from: string; to: string; }
export interface BoundaryViolation { from: string; to: string; from_zone: Zone; to_zone: Zone; reason: string }

/** Lint a set of import edges against the two hard rules. Returns the violations. */
export function lintBoundary(edges: ImportEdge[]): BoundaryViolation[] {
  const out: BoundaryViolation[] = [];
  for (const e of edges) {
    const fz = classifyZone(e.from), tz = classifyZone(e.to);
    if (fz === 'userspace' && tz === 'core') {
      out.push({ from: e.from, to: e.to, from_zone: fz, to_zone: tz, reason: 'userspace importa el núcleo directamente (debe ir por el contrato)' });
    } else if (fz === 'core' && tz === 'userspace') {
      out.push({ from: e.from, to: e.to, from_zone: fz, to_zone: tz, reason: 'el núcleo depende de userspace (lo mutable no puede ser dependencia del suelo)' });
    }
  }
  return out;
}

/** True iff the import graph respects the frontier (no crossing violations). */
export function boundaryClean(edges: ImportEdge[]): boolean {
  return lintBoundary(edges).length === 0;
}
