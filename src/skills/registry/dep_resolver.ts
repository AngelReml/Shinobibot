/**
 * Resolución de dependencias entre skills (Sprint 2.5).
 *
 * Cuando se instala una skill `A` que requires `{ B: ^1.0.0, C: >=2.1 }`,
 * el resolver:
 *
 *   1. Verifica que el registry tiene una versión publicada de B y C
 *      que satisface el rango.
 *   2. Detecta ciclos (A → B → A) y los rechaza.
 *   3. Devuelve el orden topológico de instalación (B, C, A).
 *
 * Si la skill ya está instalada con versión compatible, se omite (no
 * se reinstala). Esto requiere conocer las versiones instaladas →
 * `installedVersions: Record<name, version>`.
 */

import type { SkillRegistry, SkillManifestEntry } from './types.js';
import { compareSemver } from './local_registry.js';

export interface ResolveOptions {
  registry: SkillRegistry;
  installedVersions?: Record<string, string>;
}

export interface ResolvedPlan {
  /** Orden topológico de instalación. */
  steps: SkillManifestEntry[];
  /** Skills omitidas porque la versión instalada ya satisface. */
  skipped: Array<{ name: string; reason: string; installed: string }>;
}

export async function resolvePlan(rootName: string, opts: ResolveOptions): Promise<ResolvedPlan> {
  const installed = opts.installedVersions ?? {};
  const root = await opts.registry.resolveLatest(rootName);
  if (!root) throw new Error(`skill "${rootName}" no está en el registry`);

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const order: SkillManifestEntry[] = [];
  const skipped: Array<{ name: string; reason: string; installed: string }> = [];

  async function visit(entry: SkillManifestEntry, chain: string[]): Promise<void> {
    if (visited.has(entry.name)) return;
    if (visiting.has(entry.name)) {
      const cycle = [...chain.slice(chain.indexOf(entry.name)), entry.name].join(' → ');
      throw new Error(`ciclo de dependencias detectado: ${cycle}`);
    }
    visiting.add(entry.name);
    const requires = entry.requires ?? {};
    for (const [depName, range] of Object.entries(requires)) {
      const installedV = installed[depName];
      if (installedV && satisfies(range, installedV)) {
        skipped.push({ name: depName, reason: 'already installed satisfies range', installed: installedV });
        visited.add(depName);
        continue;
      }
      const candidate = await opts.registry.resolveLatest(depName);
      if (!candidate) throw new Error(`dependencia "${depName}" (requerida por ${entry.name}) no está en el registry`);
      if (!satisfies(range, candidate.version)) {
        throw new Error(`dependencia "${depName}" v${candidate.version} no satisface ${range} (requerido por ${entry.name})`);
      }
      await visit(candidate, [...chain, entry.name]);
    }
    visiting.delete(entry.name);
    visited.add(entry.name);
    // Si la root ya está instalada con versión >= la candidata, podemos omitirla.
    const installedV = installed[entry.name];
    if (installedV && compareSemver(installedV, entry.version) >= 0) {
      skipped.push({ name: entry.name, reason: 'already at requested version', installed: installedV });
      return;
    }
    order.push(entry);
  }

  await visit(root, []);
  return { steps: order, skipped };
}

/** Mini implementación de semver range. Soporta `^x.y.z`, `~x.y`, `>=x`, exact. */
export function satisfies(range: string, version: string): boolean {
  if (typeof range !== 'string') return false;
  const r = range.trim();
  if (!r) return false; // range vacío = no satisface (defensa: malformado)
  if (r === '*') return true;
  if (r.startsWith('^')) {
    const target = r.slice(1);
    const [maj] = target.split('.').map(Number);
    if (compareSemver(version, target) < 0) return false;
    const [vMaj] = version.split('.').map(Number);
    return vMaj === maj;
  }
  if (r.startsWith('~')) {
    const target = r.slice(1);
    const [maj, min] = target.split('.').map(Number);
    if (compareSemver(version, target) < 0) return false;
    const [vMaj, vMin] = version.split('.').map(Number);
    return vMaj === maj && vMin === min;
  }
  if (r.startsWith('>=')) return compareSemver(version, r.slice(2).trim()) >= 0;
  if (r.startsWith('>')) return compareSemver(version, r.slice(1).trim()) > 0;
  if (r.startsWith('<=')) return compareSemver(version, r.slice(2).trim()) <= 0;
  if (r.startsWith('<')) return compareSemver(version, r.slice(1).trim()) < 0;
  return compareSemver(version, r) === 0;
}
