/**
 * Tipos del registry público de skills (Sprint 2.5).
 *
 * El registry guarda metadatos de skills aprobadas oficialmente. Cada
 * entry referencia una URL de descarga (GitHub release tarball, raw
 * SKILL.md, o un directorio local en development).
 *
 * Versionado semver. Dependencias entre skills declaradas en
 * `requires`. El installer resuelve grafo de deps antes de instalar.
 */

export interface SkillManifestEntry {
  /** Identificador único en el registry. */
  name: string;
  /** Semver (1.2.3, 1.2.3-rc.1). */
  version: string;
  /** Resumen humano. */
  description: string;
  /** SHA256 esperado del SKILL.md tras descarga (verificación
   *  criptográfica adicional al signing). */
  contentSha256?: string;
  /** URL desde donde obtener el bundle. Sopported:
   *    https://raw.githubusercontent.com/.../SKILL.md
   *    github:owner/repo[#ref][:subdir]
   *    file:///path/local
   */
  source: string;
  /** Skills requeridas con su semver range (^1.0.0, >=1.2, etc.). */
  requires?: Record<string, string>;
  /** Tags libres. */
  tags?: string[];
  /** Fecha de publicación ISO. */
  publishedAt?: string;
  /** Quién firmó el release. */
  publishedBy?: string;
}

export interface SkillRegistry {
  /** Devuelve todas las entradas conocidas. */
  list(): Promise<SkillManifestEntry[]>;
  /** Resuelve un nombre a la última versión disponible. */
  resolveLatest(name: string): Promise<SkillManifestEntry | null>;
  /** Resuelve un nombre + versión exacta. */
  resolveVersion(name: string, version: string): Promise<SkillManifestEntry | null>;
}
