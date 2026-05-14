/**
 * Deep Descent — descenso recursivo del file tree con presupuesto
 * compartido + lectura selectiva por relevancia + cache persistente
 * por SHA. Sprint 2.3.
 *
 * Problema que resuelve: el `HierarchicalReader` original tenía
 * cobertura 0.06–0.26% en repos grandes (kubernetes, react, langchain)
 * porque se quedaba en la 1ª capa de directorios. Este módulo recorre
 * el árbol entero pero **prioriza archivos por relevancia a la query**
 * y cachea lecturas previas para no re-leer entre runs.
 *
 * Diseño:
 *
 *  1. **Discovery**: walk recursivo del rootDir con excludes
 *     estándar (`node_modules`, `.git`, `dist`, `build`, `target`).
 *  2. **Scoring**: cada path recibe un score 0–1 basado en:
 *       - keywords de la query en el path
 *       - extensión del archivo (códigos > docs > assets)
 *       - tamaño (penaliza >256 KB, ignora >1 MB)
 *       - profundidad (penaliza muy profundos)
 *  3. **Selección**: ordena descendente y toma los top-N hasta agotar
 *     el budget `maxFiles` o `maxBytes`.
 *  4. **Lectura**: si hay cache válido (SHA256 del archivo + mtime),
 *     usa el cacheado. Si no, lee del disco y persiste.
 *  5. **Métricas**: total visitado, top-N seleccionado, cobertura =
 *     selected / totalConsiderable.
 *
 * NO requiere LLM. Es una capa puramente heurística que el caller
 * puede usar como pre-filtro antes de pasar los archivos a un
 * sub-agente LLM.
 */

import { readdirSync, statSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, extname, relative, sep } from 'path';
import { createHash } from 'crypto';

export interface DescentOptions {
  /** Query / objetivo. Las keywords del input dirigen el scoring. */
  query: string;
  /** Máximo de archivos a SELECCIONAR para lectura (default 200). */
  maxFiles?: number;
  /** Máximo de bytes leídos en total (default 4 MiB). */
  maxBytes?: number;
  /** Profundidad máxima del walk (default 12). */
  maxDepth?: number;
  /** Patrones de exclude (case-insensitive, contains). */
  excludeDirs?: string[];
  /** Path absoluto donde cachear lecturas. Default `<cwd>/.shinobi-reader-cache/`. */
  cacheDir?: string;
  /** Si true, skip cache; default false. */
  ignoreCache?: boolean;
}

export interface FileCandidate {
  /** Path relativo al rootDir. */
  relPath: string;
  absPath: string;
  size: number;
  ext: string;
  depth: number;
  score: number;
  signals: string[];
}

export interface DescentResult {
  rootDir: string;
  query: string;
  totalDiscovered: number;
  totalConsiderable: number;  // los que cumplen filtros básicos (ext, size)
  selected: FileCandidate[];
  bytesRead: number;
  filesFromCache: number;
  filesFromDisk: number;
  coverageRatio: number;       // selected / totalConsiderable
  durationMs: number;
  truncated: boolean;          // budget agotado antes de cubrir todo lo considerable
}

const DEFAULT_EXCLUDES = [
  'node_modules', '.git', 'dist', 'build', 'target', 'out', 'bin', 'obj',
  '.next', '.nuxt', '.cache', 'coverage', '.idea', '.vscode',
  'venv', '.venv', '__pycache__', '.pytest_cache', '.mypy_cache',
];

const CODE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.kt', '.scala', '.c', '.cpp', '.h', '.hpp',
  '.rb', '.php', '.swift', '.cs', '.fs', '.ex', '.exs', '.elm', '.dart',
  '.sh', '.bash', '.ps1',
]);
const DOC_EXTS = new Set(['.md', '.mdx', '.rst', '.txt', '.adoc']);
const CONFIG_EXTS = new Set(['.json', '.yaml', '.yml', '.toml', '.ini', '.env', '.lock']);
const HARD_SKIP_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
  '.mp3', '.mp4', '.wav', '.ogg', '.flac', '.mov', '.avi',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.pdf', '.docx', '.xlsx', '.pptx',
  '.ttf', '.otf', '.woff', '.woff2',
]);

const MAX_FILE_BYTES_HARD = 1024 * 1024;       // 1 MiB: skip hard
const FILE_SIZE_SOFT_PENALTY = 256 * 1024;     // 256 KiB: penaliza score

interface DescentInternalCounters {
  considerable: number;
  bytesUsed: number;
  filesFromCache: number;
  filesFromDisk: number;
}

function tokenize(query: string): string[] {
  return (query || '')
    .toLowerCase()
    .split(/[\s,;.:/\\()[\]{}<>"'+=*&%$#@!?-]+/)
    .filter(t => t.length >= 3);
}

function scoreFile(c: FileCandidate, queryTokens: string[]): { score: number; signals: string[] } {
  const signals: string[] = [];
  let s = 0.1; // baseline para que algo se elija

  // (1) Keywords en el path.
  const lowerPath = c.relPath.toLowerCase();
  let kwHits = 0;
  for (const t of queryTokens) {
    if (lowerPath.includes(t)) {
      kwHits++;
      signals.push(`kw:${t}`);
    }
  }
  s += Math.min(0.6, kwHits * 0.15);

  // (2) Extensión.
  if (CODE_EXTS.has(c.ext)) { s += 0.20; signals.push('ext:code'); }
  else if (DOC_EXTS.has(c.ext)) { s += 0.12; signals.push('ext:doc'); }
  else if (CONFIG_EXTS.has(c.ext)) { s += 0.08; signals.push('ext:cfg'); }

  // (3) Penalización por tamaño.
  if (c.size > FILE_SIZE_SOFT_PENALTY) {
    s -= 0.10; signals.push('big-file');
  }

  // (4) Penalización por profundidad excesiva.
  if (c.depth > 8) { s -= 0.10; signals.push('deep'); }

  // (5) Boost para entry points habituales.
  const base = c.relPath.split(/[/\\]/).pop()?.toLowerCase() ?? '';
  if (/^(index|main|app|cli|server|entrypoint|run|start)\./.test(base)) {
    s += 0.10; signals.push('entry');
  }
  if (/^readme(\.md)?$/i.test(base)) { s += 0.10; signals.push('readme'); }
  if (/^package\.json$|^pyproject\.toml$|^cargo\.toml$|^go\.mod$/.test(base)) {
    s += 0.10; signals.push('manifest');
  }

  return { score: Math.max(0, Math.min(1, s)), signals };
}

function walkSync(
  rootDir: string,
  excludes: Set<string>,
  maxDepth: number,
): FileCandidate[] {
  const out: FileCandidate[] = [];
  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (excludes.has(name.toLowerCase())) continue;
      const abs = join(dir, name);
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (st.isDirectory()) {
        walk(abs, depth + 1);
        continue;
      }
      if (!st.isFile()) continue;
      const ext = extname(name).toLowerCase();
      if (HARD_SKIP_EXTS.has(ext)) continue;
      if (st.size > MAX_FILE_BYTES_HARD) continue;
      const rel = relative(rootDir, abs);
      out.push({
        relPath: rel.split(sep).join('/'),
        absPath: abs,
        size: st.size,
        ext,
        depth,
        score: 0,
        signals: [],
      });
    }
  }
  walk(rootDir, 0);
  return out;
}

function cacheKeyFor(abs: string, size: number, mtimeMs: number): string {
  const h = createHash('sha256');
  h.update(abs);
  h.update(':');
  h.update(String(size));
  h.update(':');
  h.update(String(Math.floor(mtimeMs)));
  return h.digest('hex');
}

function readWithCache(
  c: FileCandidate,
  cacheDir: string,
  ignoreCache: boolean,
  counters: DescentInternalCounters,
): { content: string; fromCache: boolean } {
  let mtimeMs = 0;
  try { mtimeMs = statSync(c.absPath).mtimeMs; } catch { /* swallow */ }
  const key = cacheKeyFor(c.absPath, c.size, mtimeMs);
  const cachePath = join(cacheDir, key.slice(0, 2), key + '.txt');

  if (!ignoreCache && existsSync(cachePath)) {
    try {
      const content = readFileSync(cachePath, 'utf-8');
      counters.filesFromCache++;
      return { content, fromCache: true };
    } catch { /* fall through to disk */ }
  }
  const content = readFileSync(c.absPath, 'utf-8');
  counters.filesFromDisk++;
  try {
    const dir = join(cacheDir, key.slice(0, 2));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(cachePath, content, 'utf-8');
  } catch { /* swallow */ }
  return { content, fromCache: false };
}

/**
 * Función principal del Sprint 2.3. Devuelve la lista de archivos
 * seleccionados (no lee a menos que se haga `readSelected`).
 */
export function discoverAndScore(rootDir: string, opts: DescentOptions): { candidates: FileCandidate[]; totalDiscovered: number; totalConsiderable: number } {
  const excludes = new Set<string>((opts.excludeDirs ?? DEFAULT_EXCLUDES).map(s => s.toLowerCase()));
  const maxDepth = opts.maxDepth ?? 12;
  const walked = walkSync(rootDir, excludes, maxDepth);
  const totalDiscovered = walked.length;
  const queryTokens = tokenize(opts.query);
  const considerable: FileCandidate[] = [];
  for (const c of walked) {
    const { score, signals } = scoreFile(c, queryTokens);
    c.score = score;
    c.signals = signals;
    if (score >= 0.05) considerable.push(c);
  }
  considerable.sort((a, b) => b.score - a.score);
  return { candidates: considerable, totalDiscovered, totalConsiderable: considerable.length };
}

/**
 * Versión completa: discover + score + read (con cache) + métricas.
 */
export function deepDescend(rootDir: string, opts: DescentOptions): DescentResult {
  const t0 = Date.now();
  const maxFiles = opts.maxFiles ?? 200;
  const maxBytes = opts.maxBytes ?? 4 * 1024 * 1024;
  const cacheDir = opts.cacheDir ?? join(rootDir, '.shinobi-reader-cache');
  if (!existsSync(cacheDir)) {
    try { mkdirSync(cacheDir, { recursive: true }); } catch { /* swallow */ }
  }

  const { candidates, totalDiscovered, totalConsiderable } = discoverAndScore(rootDir, opts);

  // Select hasta agotar budget.
  const counters: DescentInternalCounters = {
    considerable: totalConsiderable,
    bytesUsed: 0,
    filesFromCache: 0,
    filesFromDisk: 0,
  };
  const selected: FileCandidate[] = [];
  let truncated = false;
  for (const c of candidates) {
    if (selected.length >= maxFiles) { truncated = true; break; }
    if (counters.bytesUsed + c.size > maxBytes) { truncated = true; continue; }
    try {
      readWithCache(c, cacheDir, !!opts.ignoreCache, counters);
      counters.bytesUsed += c.size;
      selected.push(c);
    } catch {
      // skip archivos no legibles
    }
  }

  const coverageRatio = totalConsiderable > 0 ? selected.length / totalConsiderable : 0;

  return {
    rootDir,
    query: opts.query,
    totalDiscovered,
    totalConsiderable,
    selected,
    bytesRead: counters.bytesUsed,
    filesFromCache: counters.filesFromCache,
    filesFromDisk: counters.filesFromDisk,
    coverageRatio,
    durationMs: Date.now() - t0,
    truncated,
  };
}
