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
  // Página de GitHub: https://github.com/owner/repo[/tree/<ref>/<subdir>]
  const gh = arg.match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+?))?)?\/?$/);
  if (gh) return { kind: 'github-repo', owner: gh[1], repo: gh[2], ref: gh[3], subdir: gh[4] };
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

/** Rutas relativas (con `/`) de todos los ficheros de un bundle, ordenadas. */
export function listBundleFiles(root: string, rel = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, rel)).sort()) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const r = rel ? `${rel}/${entry}` : entry;
    const st = statSync(join(root, r));
    if (st.isDirectory()) out.push(...listBundleFiles(root, r));
    else if (st.isFile()) out.push(r);
  }
  return out;
}

/** Huella SHA256 de todo el bundle salvo el SKILL.md (que lleva su propia firma). */
export function hashBundle(root: string): string {
  const h = createHash('sha256');
  for (const rel of listBundleFiles(root)) {
    if (rel === 'SKILL.md') continue;
    h.update(rel); h.update('\0');
    h.update(readFileSync(join(root, rel))); h.update('\0');
  }
  return h.digest('hex');
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
 *
 * Fuentes implementadas:
 *   local      — copia recursiva del path local.
 *   github-raw — descarga SKILL.md desde una URL raw de GitHub.
 *   github-repo — descarga SKILL.md via raw.githubusercontent.com
 *                 (solo el SKILL.md raíz; para bundles multi-fichero usa 'local').
 *   tarball    — no implementado; extrae manualmente y usa 'local'.
 */
// ── Repos de GitHub: árbol de ficheros y descarga de un bundle ──────────────

export const BUNDLE_MAX_FILES = 200;
export const BUNDLE_MAX_FILE_BYTES = 1_000_000;
export const BUNDLE_MAX_TOTAL_BYTES = 8_000_000;
export const REPO_MAX_SKILLS = 40;

export interface RepoFile { path: string; size: number }
export interface RepoTree { ref: string; files: RepoFile[] }
export interface GithubFetcher {
  tree(owner: string, repo: string, ref?: string): Promise<RepoTree>;
  file(owner: string, repo: string, ref: string, path: string): Promise<Buffer>;
}

// Clones de respaldo, por `owner/repo@ref`. Se reutilizan dentro del proceso
// (un plugin con 15 skills no se clona 15 veces) y se borran al salir.
const _clones = new Map<string, string>();
let _cloneCleanupHooked = false;

function walkFiles(root: string, rel = ''): RepoFile[] {
  const out: RepoFile[] = [];
  for (const entry of readdirSync(join(root, rel))) {
    if (entry === '.git' || entry === 'node_modules') continue;
    const r = rel ? `${rel}/${entry}` : entry;
    const st = statSync(join(root, r));
    if (st.isDirectory()) out.push(...walkFiles(root, r));
    else if (st.isFile()) out.push({ path: r, size: st.size });
  }
  return out;
}

/**
 * Respaldo cuando la API de GitHub no responde (sin clave solo admite 60
 * consultas por hora, y hay redes que la bloquean): `git clone --depth 1`.
 * Sin shell y con owner/repo/ref ya validados, así que no hay nada que inyectar.
 */
async function cloneRepo(owner: string, repo: string, ref?: string): Promise<{ dir: string; ref: string }> {
  if (ref !== undefined && !/^[\w./-]{1,100}$/.test(ref)) throw new Error('ref de GitHub no válida');
  const key = `${owner}/${repo}@${ref ?? ''}`;
  const cached = _clones.get(key);
  if (cached && existsSync(cached)) return { dir: cached, ref: ref ?? 'HEAD' };
  const { execFile } = await import('child_process');
  const dir = join(tmpdir(), `shinobi-skill-clone-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const args = ['clone', '--depth', '1', '--quiet', ...(ref ? ['--branch', ref] : []), `https://github.com/${owner}/${repo}.git`, dir];
  await new Promise<void>((res, rej) => {
    execFile('git', args, { timeout: 180_000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' } },
      (err, _out, stderr) => err ? rej(new Error(`git clone falló: ${String(stderr || err.message).trim().slice(0, 300)}`)) : res());
  });
  _clones.set(key, dir);
  if (!_cloneCleanupHooked) {
    _cloneCleanupHooked = true;
    process.on('exit', () => { for (const d of _clones.values()) { try { rmSync(d, { recursive: true, force: true }); } catch { /* */ } } });
  }
  return { dir, ref: ref ?? 'HEAD' };
}

const httpGithub: GithubFetcher = {
  async tree(owner, repo, ref) {
    try {
      const axios = (await import('axios')).default;
      const headers: Record<string, string> = { 'User-Agent': 'shinobi-skill-installer', Accept: 'application/vnd.github+json' };
      const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      if (token) headers.Authorization = `Bearer ${token}`;
      let useRef = ref;
      if (!useRef) {
        const info = await axios.get(`https://api.github.com/repos/${owner}/${repo}`, { timeout: 30000, headers });
        useRef = String(info.data?.default_branch || 'main');
      }
      const resp = await axios.get(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(useRef)}?recursive=1`, { timeout: 30000, headers });
      if (resp.data?.truncated) throw new Error('árbol truncado por la API');
      const files = (resp.data?.tree ?? []).filter((t: any) => t.type === 'blob').map((t: any) => ({ path: String(t.path), size: Number(t.size ?? 0) }));
      return { ref: useRef, files };
    } catch (apiErr: any) {
      if (apiErr?.response?.status === 404) throw new Error(`el repo ${owner}/${repo} no existe o es privado`);
      try {
        const c = await cloneRepo(owner, repo, ref);
        return { ref: c.ref, files: walkFiles(c.dir) };
      } catch (gitErr: any) {
        throw new Error(`no se pudo leer ${owner}/${repo}: la API de GitHub respondió «${apiErr?.response?.status ?? apiErr?.message}» y ${gitErr?.message ?? gitErr}`);
      }
    }
  },
  async file(owner, repo, ref, path) {
    const clone = _clones.get(`${owner}/${repo}@${ref === 'HEAD' ? '' : ref}`) ?? _clones.get(`${owner}/${repo}@${ref}`);
    if (clone && existsSync(clone)) {
      const abs = resolve(clone, ...path.split('/'));
      if (!abs.startsWith(resolve(clone))) throw new Error(`ruta fuera del repo: ${path}`);
      return readFileSync(abs);
    }
    const axios = (await import('axios')).default;
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${path.split('/').map(encodeURIComponent).join('/')}`;
    const resp = await axios.get(url, { timeout: 30000, responseType: 'arraybuffer', maxContentLength: BUNDLE_MAX_FILE_BYTES });
    return Buffer.from(resp.data);
  },
};

let _github: GithubFetcher = httpGithub;
/** Los tests sustituyen la red por un repo en memoria. */
export function setGithubFetcherForTesting(f: GithubFetcher | null): void { _github = f ?? httpGithub; }

async function fetchRepoTree(owner: string, repo: string, ref?: string): Promise<RepoTree> {
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) throw new Error('owner/repo de GitHub no válido');
  return _github.tree(owner, repo, ref);
}

/** Carpetas del repo que contienen un SKILL.md ('' = raíz), sin las anidadas en otra skill. */
export function skillDirsInTree(paths: string[]): string[] {
  const dirs = paths
    .filter(p => p === 'SKILL.md' || p.endsWith('/SKILL.md'))
    .filter(p => !/(^|\/)(node_modules|\.git|test|tests|__tests__|fixtures|examples?|evals?)\//i.test(p))
    .map(p => p === 'SKILL.md' ? '' : p.slice(0, -'/SKILL.md'.length))
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  const out: string[] = [];
  for (const d of dirs) {
    if (out.some(o => o === '' ? false : d.startsWith(o + '/'))) continue; // sub-skill de otra ya listada
    out.push(d);
  }
  return out.slice(0, REPO_MAX_SKILLS);
}

/** Una ruta del repo solo se escribe si se queda dentro del bundle. */
function safeRelative(rel: string): boolean {
  return rel.length > 0 && !rel.startsWith('/') && !/^[A-Za-z]:/.test(rel) && !rel.split('/').some(seg => seg === '..' || seg === '' || seg === '.git' || seg === 'node_modules');
}

async function downloadBundle(owner: string, repo: string, ref: string, prefix: string, files: RepoFile[], dst: string): Promise<void> {
  const mine = files.filter(f => f.path.startsWith(prefix)).map(f => ({ ...f, rel: f.path.slice(prefix.length) })).filter(f => safeRelative(f.rel));
  if (mine.length > BUNDLE_MAX_FILES) throw new Error(`la skill tiene ${mine.length} ficheros (máximo ${BUNDLE_MAX_FILES})`);
  let total = 0;
  for (const f of mine) {
    if (f.size > BUNDLE_MAX_FILE_BYTES) throw new Error(`fichero demasiado grande en la skill: ${f.rel} (${f.size} bytes)`);
    total += f.size;
    if (total > BUNDLE_MAX_TOTAL_BYTES) throw new Error(`la skill pesa más de ${BUNDLE_MAX_TOTAL_BYTES} bytes`);
  }
  for (const f of mine) {
    const buf = await _github.file(owner, repo, ref, f.path);
    if (buf.length > BUNDLE_MAX_FILE_BYTES) throw new Error(`fichero demasiado grande en la skill: ${f.rel}`);
    const out = join(dst, ...f.rel.split('/'));
    if (!resolve(out).startsWith(resolve(dst))) throw new Error(`ruta fuera del bundle: ${f.rel}`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, buf);
  }
}

/**
 * Lista las skills de un repo de GitHub (un repo de skills, un plugin de
 * Claude Code con carpeta `skills/`, o una skill suelta en la raíz).
 */
export async function discoverRepoSkills(owner: string, repo: string, ref?: string): Promise<{ ref: string; dirs: string[] }> {
  const tree = await fetchRepoTree(owner, repo, ref);
  return { ref: tree.ref, dirs: skillDirsInTree(tree.files.map(f => f.path)) };
}

async function materializeSource(source: SkillSource): Promise<{ tmpDir: string; cleanup: () => void; }> {
  const makeTmp = (): string => {
    const d = join(tmpdir(), `shinobi-skill-stage-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(d, { recursive: true });
    return d;
  };
  const makeCleanup = (d: string) => () => { try { rmSync(d, { recursive: true, force: true }); } catch { } };

  if (source.kind === 'local') {
    const abs = resolve(source.path);
    if (!existsSync(abs)) throw new Error(`local path no existe: ${abs}`);
    const tmpDir = makeTmp();
    copyRecursive(abs, tmpDir);
    return { tmpDir, cleanup: makeCleanup(tmpDir) };
  }

  if (source.kind === 'github-raw') {
    const tmpDir = makeTmp();
    const axios = (await import('axios')).default;
    const resp = await axios.get(source.url, { timeout: 30000, responseType: 'text' });
    writeFileSync(join(tmpDir, 'SKILL.md'), String(resp.data), 'utf-8');
    return { tmpDir, cleanup: makeCleanup(tmpDir) };
  }

  if (source.kind === 'github-repo') {
    // Bundle completo (SKILL.md + references/, scripts/, assets/…): las skills
    // de Claude Code reparten sus instrucciones en varios ficheros.
    const tree = await fetchRepoTree(source.owner, source.repo, source.ref);
    const prefix = source.subdir ? source.subdir.replace(/^\/+|\/+$/g, '') + '/' : '';
    if (!tree.files.some(p => p.path === `${prefix}SKILL.md`)) {
      const found = skillDirsInTree(tree.files.map(p => p.path));
      throw new Error(found.length > 0
        ? `no hay SKILL.md en ${prefix || 'la raíz'}; el repo trae ${found.length} skill(s): ${found.slice(0, 8).map(d => d || '(raíz)').join(', ')}`
        : `el repo ${source.owner}/${source.repo} no contiene ningún SKILL.md`);
    }
    const tmpDir = makeTmp();
    await downloadBundle(source.owner, source.repo, tree.ref, prefix, tree.files, tmpDir);
    return { tmpDir, cleanup: makeCleanup(tmpDir) };
  }

  if (source.kind === 'tarball') {
    throw new Error(
      `tarball source no implementado. Extrae el archivo localmente y usa: file://<ruta-al-directorio-extraído>`,
    );
  }

  const _exhaustive: never = source;
  throw new Error(`source kind desconocido: ${(_exhaustive as any).kind}`);
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

    // La firma solo cubre el SKILL.md. Para que tampoco se puedan cambiar a
    // escondidas los demás ficheros del bundle (scripts, referencias), su
    // huella conjunta se guarda en el frontmatter ANTES de firmar: así queda
    // cubierta por la firma.
    parsed.frontmatter.bundle_hash = hashBundle(tmpDir);
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
