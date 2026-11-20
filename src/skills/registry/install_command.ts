/**
 * `/skill install` — instala una skill desde el registry o desde una
 * fuente directa.
 *
 * Cierra el último cabo de la cadena federada de skills: `installFromRegistry`
 * (resolución de deps + rollback + verificación contentSha256) e
 * `installSkillFromSource` (auditoría + firma) existían y estaban testeados,
 * pero ningún comando de usuario los invocaba — eran ghost features.
 *
 * Dos modos, autodetectados por el argumento:
 *   - Fuente directa: `github:owner/repo`, `https://.../SKILL.md`,
 *     `file://path`, o una ruta local existente → installSkillFromSource.
 *   - Nombre de skill → se resuelve contra el registry configurado en
 *     `SHINOBI_SKILL_REGISTRY` (ruta a un registry.json o URL) y se delega
 *     en installFromRegistry (que resuelve dependencias).
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { LocalRegistry } from './local_registry.js';
import { installFromRegistry } from './installer.js';
import { installSkillFromSource, parseSkillSource, discoverRepoSkills } from '../anthropic_skill_installer.js';
import type { SkillManifestEntry } from './types.js';

export interface SkillInstallOutcome {
  ok: boolean;
  lines: string[];
}

/** ¿El argumento es una fuente directa (URL/path) en vez de un nombre? */
export function isDirectSource(arg: string): boolean {
  return /^(file:\/\/|github:|https?:\/\/)/i.test(arg) || existsSync(arg);
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
  return await res.text();
}

/** Construye el SkillRegistry desde SHINOBI_SKILL_REGISTRY (ruta o URL). */
async function buildRegistry(): Promise<LocalRegistry> {
  const src = process.env.SHINOBI_SKILL_REGISTRY;
  if (!src) {
    throw new Error(
      'no hay registry configurado. Define SHINOBI_SKILL_REGISTRY (ruta a un ' +
      'registry.json o una URL), o pasa una fuente directa: ' +
      'github:owner/repo · https://.../SKILL.md · file://path',
    );
  }
  if (/^https?:\/\//i.test(src)) {
    const parsed = JSON.parse(await fetchText(src));
    if (!parsed || !Array.isArray(parsed.entries)) {
      throw new Error('registry.json remoto inválido: se esperaba {entries:[...]}');
    }
    return new LocalRegistry(parsed.entries as SkillManifestEntry[]);
  }
  return new LocalRegistry(src); // ruta local a registry.json
}

/**
 * Ejecuta `/skill install <arg>`. Devuelve un outcome con líneas listas
 * para imprimir. Nunca lanza — los errores se devuelven en `lines`.
 */
export async function runSkillInstall(
  arg: string,
  opts: { skillsRoot?: string; allowWarnings?: boolean; only?: string[] } = {},
): Promise<SkillInstallOutcome> {
  const lines: string[] = [];
  const skillsRoot = opts.skillsRoot ?? join(process.cwd(), 'skills');
  if (!arg) {
    return {
      ok: false,
      lines: ['Usage: /skill install <nombre> | github:owner/repo | https://.../SKILL.md | file://path  [--allow-warnings]'],
    };
  }

  // `owner/repo` a secas: lo que se escribe tras `/plugin marketplace add` o
  // `npx skills add` en el mundo de Claude Code. Se trata como repo de GitHub.
  if (/^[\w.-]+\/[\w.-]+$/.test(arg) && !existsSync(arg)) arg = `github:${arg}`;

  // Repo de GitHub sin carpeta concreta: puede traer una skill o muchas
  // (repo de skills, plugin de Claude Code). Se instalan todas, una a una,
  // cada una con su auditoría.
  if (isDirectSource(arg)) {
    try {
      const src = parseSkillSource(arg);
      if (src.kind === 'github-repo' && !src.subdir) {
        const found = await discoverRepoSkills(src.owner, src.repo, src.ref);
        if (found.dirs.length === 0) return { ok: false, lines: [`✗ ${src.owner}/${src.repo} no contiene ningún SKILL.md: no es una skill ni un plugin con skills`] };
        // --only a,b: de un repo que trae varias, instala solo las nombradas (por
        // el nombre de su carpeta). Un repo puede traer skills de su propio
        // desarrollo que no pintan nada en tu catálogo.
        if (opts.only && opts.only.length > 0) {
          const want = new Set(opts.only.map(n => n.toLowerCase()));
          const all = found.dirs;
          found.dirs = all.filter(d => want.has((d.slice(d.lastIndexOf('/') + 1) || src.repo).toLowerCase()));
          if (found.dirs.length === 0) {
            return { ok: false, lines: [`✗ ${src.owner}/${src.repo} no trae ninguna skill llamada ${opts.only.join(', ')}. Tiene: ${all.map(d => d.slice(d.lastIndexOf('/') + 1) || '(raíz)').join(', ')}`] };
          }
        }
        if (!(found.dirs.length === 1 && found.dirs[0] === '')) {
          if (found.dirs.length > 1) lines.push(`(para instalar solo algunas: /skill install ${src.owner}/${src.repo} --only <nombre>[,<nombre>])`);
          let okCount = 0;
          lines.push(`${src.owner}/${src.repo} trae ${found.dirs.length} skill(s):`);
          for (const dir of found.dirs) {
            const refPart = src.ref ? `#${src.ref}` : (found.ref && found.ref !== 'HEAD' ? `#${found.ref}` : '');
            const one = `github:${src.owner}/${src.repo}${refPart}${dir ? `:${dir}` : ''}`;
            try {
              const r = await installSkillFromSource(one, { skillsRoot, allowWarnings: opts.allowWarnings, overwrite: true });
              if (r.accepted) { okCount++; lines.push(`  ✓ ${r.skillName}  (${dir || 'raíz'})`); }
              else lines.push(`  ✗ ${dir || 'raíz'}: ${r.requiresConfirmation ? 'el auditor encontró avisos (repite con --allow-warnings si te fías)' : (r.reason ?? 'rechazada por el auditor')}`);
            } catch (e: any) { lines.push(`  ✗ ${dir || 'raíz'}: ${e?.message ?? e}`); }
          }
          lines.push(okCount > 0 ? `${okCount} instalada(s). Ya están disponibles: Shinobi las verá en su lista de skills.` : 'No se instaló ninguna.');
          return { ok: okCount > 0, lines };
        }
      }
    } catch (e: any) {
      return { ok: false, lines: [`✗ error leyendo ${arg}: ${e?.message ?? e}`] };
    }
  }

  // Modo fuente directa.
  if (isDirectSource(arg)) {
    try {
      const r = await installSkillFromSource(arg, {
        skillsRoot, allowWarnings: opts.allowWarnings, overwrite: true,
      });
      if (r.accepted) {
        lines.push(`✓ instalada desde fuente directa: ${arg}`);
        if (r.destination) lines.push(`  destino: ${r.destination}`);
        return { ok: true, lines };
      }
      lines.push(`✗ rechazada: ${r.reason ?? 'install rechazada por el auditor'}`);
      if (r.requiresConfirmation) {
        lines.push('  el auditor encontró warnings — si confías en la skill, reinstala con --allow-warnings');
      }
      return { ok: false, lines };
    } catch (e: any) {
      return { ok: false, lines: [`✗ error instalando ${arg}: ${e?.message ?? e}`] };
    }
  }

  // Modo nombre contra el registry.
  let registry: LocalRegistry;
  try {
    registry = await buildRegistry();
  } catch (e: any) {
    return { ok: false, lines: [`✗ ${e?.message ?? e}`] };
  }

  try {
    const result = await installFromRegistry(arg, registry, { skillsRoot, allowWarnings: opts.allowWarnings });
    for (const i of result.installed) lines.push(`✓ instalada: ${i.name}@${i.version} → ${i.destination}`);
    for (const s of result.skipped) lines.push(`• omitida: ${s.name} (${s.reason})`);
    for (const e of result.errors) lines.push(`✗ error: ${e.name} — ${e.error}`);
    if (result.installed.length === 0 && result.errors.length === 0 && result.skipped.length === 0) {
      lines.push(`✗ la skill '${arg}' no está en el registry`);
    }
    return { ok: result.errors.length === 0 && result.installed.length > 0, lines };
  } catch (e: any) {
    // resolvePlan lanza si el nombre o una dependencia no se resuelve.
    return { ok: false, lines: [`✗ no se pudo instalar '${arg}': ${e?.message ?? e}`] };
  }
}
