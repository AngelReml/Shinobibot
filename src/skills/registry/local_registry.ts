/**
 * LocalRegistry — implementación de SkillRegistry leyendo un JSON local.
 * Útil para tests y para desarrollo de un mirror del registry público.
 *
 * Formato del archivo `registry.json`:
 *   { "entries": [SkillManifestEntry, ...] }
 *
 * Para el registry público real (Sprint 2.5), publicamos un
 * `shinobibot-skills-registry` en GitHub con un `registry.json` en su
 * raíz y firmado por commit signatures. GitHubRegistry envuelve este
 * formato y descarga vía raw.githubusercontent.
 */

import { readFileSync, existsSync } from 'fs';
import type { SkillRegistry, SkillManifestEntry } from './types.js';

export class LocalRegistry implements SkillRegistry {
  private readonly entries: SkillManifestEntry[];

  constructor(entriesOrPath: SkillManifestEntry[] | string) {
    if (Array.isArray(entriesOrPath)) {
      this.entries = entriesOrPath;
    } else {
      this.entries = loadFromFile(entriesOrPath);
    }
  }

  async list(): Promise<SkillManifestEntry[]> {
    return [...this.entries];
  }

  async resolveLatest(name: string): Promise<SkillManifestEntry | null> {
    const matches = this.entries
      .filter(e => e.name === name)
      .sort((a, b) => compareSemver(b.version, a.version));
    return matches[0] ?? null;
  }

  async resolveVersion(name: string, version: string): Promise<SkillManifestEntry | null> {
    return this.entries.find(e => e.name === name && e.version === version) ?? null;
  }
}

function loadFromFile(path: string): SkillManifestEntry[] {
  if (!existsSync(path)) throw new Error(`registry file no existe: ${path}`);
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.entries)) throw new Error('registry.json: esperado {entries: [...]}');
  return parsed.entries;
}

/** Compara dos semvers `a.b.c[-pre]`. -1 si a<b, 0 igual, 1 si a>b. */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('-')[0].split('.').map(Number);
  const pb = b.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}
