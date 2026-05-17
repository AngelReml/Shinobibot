/**
 * Anthropic Skills Installer — descarga, audita, firma y aprueba.
 *
 * Acepta cuatro fuentes:
 *
 *   - `file://path` o ruta absoluta local → copia recursiva.
 *   - GitHub repo (`github:owner/repo[#ref][:subdir]`) → tarball API.
 *   - GitHub raw URL → descarga el SKILL.md + archivos referenciados.
 *   - URL HTTPS arbitraria a tarball → descarga + extrae.
 *
 * El flujo:
 *
 *   1. Resolver origen → directorio temporal con el bundle.
 *   2. Validar que existe SKILL.md en raíz (o en `subdir`).
 *   3. Parsear frontmatter (name, description, license, ...).
 *   4. `skill_auditor.auditPath()` sobre el bundle.
 *   5. Política:
 *        verdict=critical → rechaza con findings, no copia nada.
 *        verdict=warning  → si `opts.allowWarnings === true` continúa,
 *                           si no devuelve `{accepted:false, requires_confirmation:true}`.
 *        verdict=clean    → continúa.
 *   6. Sub-skills (Superpowers): si el bundle tiene `subskills/<name>/SKILL.md`
 *      anidados, los audita también y exige verdict global clean/warning.
 *   7. Firma el SKILL.md raíz con `signSkill({ author: <source-url> })`.
 *   8. Copia el bundle entero a `<skillsRoot>/approved/<name>/` y registra
 *      el evento en `audit/skills_registry.jsonl`.
 *
 * Esta primera versión soporta fuentes LOCALES y GITHUB-RAW (descarga
 * via axios). Tarball GitHub queda como TODO menor (mismo flujo, distinto
 * fetcher); la prueba funcional del sprint usa fuentes locales que
 * reproducen fielmente skills del ecosistema Anthropic.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync, copyFileSync, rmSync } from 'fs';
import { join, basename, dirname, resolve } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import { auditPath, formatAuditSummary, type AuditResult } from './skill_auditor.js';
import { parseSkillMd, serializeSkillMd } from './skill_md_parser.js';
import { signSkill } from './skill_signing.js';

export type SkillSource =
  | { kind: 'local'; path: string }
  | { kind: 'github-raw'; url: string }
  | { kind: 'github-repo'; owner: string; repo: string; ref?: string; subdir?: string }
  | { kind: 'tarball'; url: string };

export interface InstallOptions {
  /** Directorio raíz `skills/`. Default: `<cwd>/skills`. */
  skillsRoot?: string;
  /** Permite warnings (sin confirmación humana). Default false. */
  allowWarnings?: boolean;
  /** Sobrescribir si ya existe approved con mismo nombre. Default false. */
  overwrite?: boolean;
  /** Author override para signSkill. Default: la source URL original. */
  author?: string;
  /** SHA256 esperado del SKILL.md recién descargado (antes de firmar). Si
   *  se pasa y no coincide, la install se rechaza (análogo a C10). */
  expectedSha256?: string;
}

export interface InstallResult {
  accepted: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
  skillName?: string;
  destination?: string;
  audit: AuditResult;
  source: string;
  signedAt?: string;
  subSkills: string[];
}

const REGISTRY_FILE = 'skills_registry.jsonl';

/** Parsea un argumento de usuario en un `SkillSource` tipado. */
export function parseSkillSource(arg: string): SkillSource {
  if (!arg || typeof arg !== 'string') throw new Error('source vacío');
  // Local: ruta existente, o prefijo file://
  if (arg.startsWith('file://')) return { kind: 'local', path: arg.slice('file://'.length) };
  // GitHub shorthand: github:owner/repo[#ref][:subdir]
  if (arg.startsWith('github:')) {
    const rest = arg.slice('github:'.length);
    const subdirIdx = rest.indexOf(':');
    const tail = subdirIdx >= 0 ? rest.slice(subdirIdx + 1) : undefined;
    const head = subdirIdx >= 0 ? rest.slice(0, subdirIdx) : rest;
    const refIdx = head.indexOf('#');
    const ref = refIdx >= 0 ? head.slice(refIdx + 1) : undefined;
    const ownerRepo = refIdx >= 0 ? head.slice(0, refIdx) : head;
    const [owner, repo] = ownerRepo.split('/');
    if (!owner || !repo) throw new Error(`github source mal formado: ${arg}`);
    return { kind: 'github-repo', owner, repo, ref, subdir: tail };
  }
  // HTTPS raw a github
  if (/^https?:\/\/raw\.githubusercontent\.com\//.test(arg)) {
    return { kind: 'github-raw', url: arg };
  }
  // Tarball genérico
  if (/^https?:\/\//.test(arg) && /\.(tar\.gz|tgz|zip)(\?|$)/.test(arg)) {
    return { kind: 'tarball', url: arg };
  }
  // Fallback: tratar como path local si existe
  if (existsSync(arg)) return { kind: 'local', path: arg };
  throw new Error(`source no reconocido: ${arg}`);
}

function copyRecursive(src: string, dst: string): void {
  const stat = statSync(src);
  if (stat.isDirectory()) {
    if (!existsSync(dst)) mkdirSync(dst, { recursive: true });
    for (const entry of readdirSync(src)) {
      if (entry === 'node_modules' || entry === '.git') continue;
      copyRecursive(join(src, entry), join(dst, entry));
    }
  } else if (stat.isFile()) {
    if (!existsSync(dirname(dst))) mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
  }
}

function detectSubSkills(skillRoot: string): string[] {
  // Convención Superpowers: subdirectorio `subskills/<name>/SKILL.md`.
  const sub: string[] = [];
  const subRoot = join(skillRoot, 'subskills');
  if (existsSync(subRoot) && statSync(subRoot).isDirectory()) {
    for (const entry of readdirSync(subRoot)) {
      const inner = join(subRoot, entry);
      if (statSync(inner).isDirectory() && existsSync(join(inner, 'SKILL.md'))) {
        sub.push(entry);
      }
    }
  }
  return sub.sort();
}

function appendRegistry(skillsRoot: string, record: any): void {
  const auditDir = join(skillsRoot, '..', 'audits');
  if (!existsSync(auditDir)) {
    try { mkdirSync(auditDir, { recursive: true }); } catch { /* registry es best-effort */ }
  }
  const path = join(auditDir, REGISTRY_FILE);
  try {
    const line = JSON.stringify(record) + '\n';
    writeFileSync(path, line, { flag: 'a', encoding: 'utf-8' });
  } catch {
    // best-effort
  }
}

/**
 * Resuelve un SkillSource a un directorio temporal listo para auditar.
 * Solo implementamos `local` y `github-raw` aquí; los otros lanzan
 * `not_implemented` para que el caller los maneje (e.g. usando `gh` o
 * `git clone`) o el sprint los siga después.
 */
async function materializeSource(source: SkillSource): Promise<{ tmpDir: string; cleanup: () => void; }> {
  if (source.kind === 'local') {
    const abs = resolve(source.path);
    if (!existsSync(abs)) throw new Error(`local path no existe: ${abs}`);
    // Materializamos en un tmp para no contaminar el origen.
    const tmpDir = join(tmpdir(), `shinobi-skill-stage-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    copyRecursive(abs, tmpDir);
    return { tmpDir, cleanup: () => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { } } };
  }
  if (source.kind === 'github-raw') {
    const tmpDir = join(tmpdir(), `shinobi-skill-stage-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    // Importamos axios bajo demanda para no añadirlo al cold path.
    const axios = (await import('axios')).default;
    const resp = await axios.get(source.url, { timeout: 30000, responseType: 'text' });
    writeFileSync(join(tmpDir, 'SKILL.md'), String(resp.data), 'utf-8');
    return { tmpDir, cleanup: () => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { } } };
  }
  throw new Error(`source kind no implementado todavía: ${source.kind}`);
}

export async function installSkillFromSource(arg: string, opts: InstallOptions = {}): Promise<InstallResult> {
  const source = parseSkillSource(arg);
  const skillsRoot = opts.skillsRoot || join(process.cwd(), 'skills');
  const approvedDir = join(skillsRoot, 'approved');
  if (!existsSync(approvedDir)) mkdirSync(approvedDir, { recursive: true });

  const { tmpDir, cleanup } = await materializeSource(source);
  try {
    const skillMdPath = join(tmpDir, 'SKILL.md');
    if (!existsSync(skillMdPath)) {
      throw new Error(`no se encontró SKILL.md en la raíz del bundle (${tmpDir})`);
    }
    const skillMdRaw = readFileSync(skillMdPath, 'utf-8');
    const parsed = parseSkillMd(skillMdRaw);
    const name = (parsed.frontmatter.name as string) || basename(tmpDir);
    if (!name || !/^[\w\-.]{1,80}$/.test(name)) {
      throw new Error(`name inválido en frontmatter: ${JSON.stringify(parsed.frontmatter.name)}`);
    }

    const audit = auditPath(tmpDir);
    const subSkills = detectSubSkills(tmpDir);

    // Verifica el hash del SKILL.md DESCARGADO contra el declarado por el
    // registry, antes de firmar (la firma reescribe el fichero, así que el
    // hash no se puede comprobar después). Análogo a C10: una fuente o
    // mirror comprometido podría servir un SKILL.md distinto al anunciado.
    if (opts.expectedSha256) {
      const actual = createHash('sha256').update(skillMdRaw, 'utf-8').digest('hex');
      if (actual.toLowerCase() !== opts.expectedSha256.toLowerCase()) {
        return {
          accepted: false,
          reason: `contentSha256 mismatch: declarado ${opts.expectedSha256.slice(0, 12)}… ≠ real ${actual.slice(0, 12)}…`,
          audit,
          source: arg,
          subSkills,
        };
      }
    }

    const baseRecord = {
      ts: new Date().toISOString(),
      source: arg,
      name,
      verdict: audit.verdict,
      findings: audit.findings.map(f => ({ rule: f.rule, level: f.level, file: f.file, line: f.line, reason: f.reason })),
      subSkills,
    };

    if (audit.verdict === 'critical') {
      appendRegistry(skillsRoot, { ...baseRecord, accepted: false, reason: 'critical_findings' });
      return {
        accepted: false,
        reason: 'critical_findings',
        audit,
        source: arg,
        subSkills,
      };
    }
    if (audit.verdict === 'warning' && !opts.allowWarnings) {
      appendRegistry(skillsRoot, { ...baseRecord, accepted: false, reason: 'pending_confirmation' });
      return {
        accepted: false,
        requiresConfirmation: true,
        reason: 'warnings_present',
        audit,
        source: arg,
        subSkills,
      };
    }

    // Firmar el SKILL.md con el origen como `signed_by`.
    const author = opts.author || arg;
    const signed = signSkill(parsed, { author });
    writeFileSync(skillMdPath, serializeSkillMd(signed), 'utf-8');

    // Copia bundle entero a `approved/<name>/`.
    const dst = join(approvedDir, name);
    if (existsSync(dst)) {
      if (!opts.overwrite) {
        throw new Error(`skill "${name}" ya existe en approved/; usa overwrite:true`);
      }
      rmSync(dst, { recursive: true, force: true });
    }
    copyRecursive(tmpDir, dst);

    const signedAt = String(signed.frontmatter.signed_at ?? '');
    appendRegistry(skillsRoot, { ...baseRecord, accepted: true, destination: dst, signed_at: signedAt });

    return {
      accepted: true,
      skillName: name,
      destination: dst,
      audit,
      source: arg,
      signedAt,
      subSkills,
    };
  } finally {
    cleanup();
  }
}

/** Helper para CLI: formatea el resultado en líneas legibles. */
export function formatInstallResult(r: InstallResult): string {
  const lines: string[] = [];
  lines.push(`source: ${r.source}`);
  lines.push(formatAuditSummary(r.audit, r.skillName ?? '(name pendiente)'));
  if (r.accepted) {
    lines.push(`OK · installed at ${r.destination}`);
    if (r.subSkills.length > 0) lines.push(`  sub-skills detected: ${r.subSkills.join(', ')}`);
    if (r.signedAt) lines.push(`  signed_at: ${r.signedAt}`);
  } else if (r.requiresConfirmation) {
    lines.push('REQUIRES CONFIRMATION · warnings present; relaunch with --allow-warnings to accept.');
  } else {
    lines.push(`REJECTED · ${r.reason ?? 'unknown'}`);
  }
  return lines.join('\n');
}
