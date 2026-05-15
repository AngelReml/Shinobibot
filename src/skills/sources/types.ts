/**
 * SkillSource — fuente desde la que Shinobi puede descubrir e
 * instalar skills.
 *
 * Cada fuente expone:
 *   - `id`           identificador estable
 *   - `priority`     0 (más alta) … N
 *   - `search(query)` lista skills disponibles que matchean
 *   - `fetch(name)`  devuelve el manifest + body para instalar
 *
 * El registro federado prueba fuentes en orden de prioridad:
 *   local (0) → agentskills.io (10) → ClawHub (20) → GitHub (30)
 *
 * Si una fuente no está configurada (env), se skipea silenciosamente.
 */

export interface RemoteSkillMeta {
  /** Nombre canonical (slug). */
  name: string;
  /** Versión semver. */
  version: string;
  /** Resumen corto. */
  description: string;
  /** Autor / publicador. */
  author?: string;
  /** Tags. */
  tags?: string[];
  /** Source id que la sirve. */
  source: string;
  /** URL bruta del bundle (zip/tarball) si aplica. */
  bundleUrl?: string;
  /** content_hash SHA256 si la fuente lo expone. */
  contentHash?: string;
}

export interface SkillBundle {
  manifest: { name: string; version: string; description?: string; author?: string };
  /** Cuerpo Markdown del SKILL.md. */
  body: string;
  /** Hash declarado por la fuente (opcional). */
  declaredHash?: string;
}

export interface SkillSource {
  readonly id: string;
  readonly priority: number;
  isConfigured(): boolean;
  search(query: string): Promise<RemoteSkillMeta[]>;
  fetch(name: string, version?: string): Promise<SkillBundle>;
}

export class SkillNotFoundError extends Error {
  constructor(public readonly name: string, public readonly source: string) {
    super(`skill not found: ${name} en ${source}`);
  }
}
