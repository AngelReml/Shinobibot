// src/reader/repo_map.ts
// G4-1 F2.1 — RepoMap: índice símbolo→archivo para retrieval semántico en repos.
//
// El cuello de botella de SWE-bench es localizar el archivo/función correcto
// entre decenas de ficheros. Este módulo:
//   1. INDEXA un directorio: extrae símbolos (funciones/clases/exports) de cada
//      archivo JS/TS con un parser ligero basado en regex (sin deps externas).
//   2. RANKEA por relevancia BM25-like (TF-IDF simplificado, sin embeddings) —
//      dado un query, devuelve los archivos más probables de contener el bug.
//   3. EXTRAE contexto: dado un archivo + query, extrae el fragmento relevante.
//
// Completamente síncrono y sin red. Se integra con HierarchicalReader (E6) como
// paso previo de localización antes de leer el archivo completo.

import * as fs from 'fs';
import * as path from 'path';

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface FileSymbol {
  kind: 'function' | 'class' | 'export' | 'variable';
  name: string;
  /** Número de línea aproximado (1-based). */
  line: number;
}

export interface FileEntry {
  /** Ruta relativa al root del repo. */
  relPath: string;
  /** Símbolos extraídos. */
  symbols: FileSymbol[];
  /** Palabras indexadas del contenido (frecuencia). */
  termFreq: Map<string, number>;
  /** Total de términos en el archivo. */
  totalTerms: number;
}

export interface RepoMap {
  /** Directorio raíz indexado. */
  root: string;
  /** Archivos indexados. */
  files: FileEntry[];
  /** IDF de cada término (precalculado). */
  idf: Map<string, number>;
}

export interface SearchResult {
  relPath: string;
  score: number;
  matchedSymbols: string[];
  /** Fragmento de contexto relevante (líneas alrededor del mejor match). */
  snippet: string;
}

// ── Constantes ────────────────────────────────────────────────────────────────

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '__pycache__']);
const MAX_FILE_BYTES = 200_000;

// ── Parser de símbolos (regex, sin deps) ─────────────────────────────────────

const SYMBOL_PATTERNS: Array<{ re: RegExp; kind: FileSymbol['kind'] }> = [
  { re: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm,        kind: 'function'  },
  { re: /^(?:export\s+)?class\s+(\w+)/gm,                        kind: 'class'     },
  { re: /^export\s+(?:const|let|var)\s+(\w+)/gm,                 kind: 'export'    },
  { re: /^(?:const|let|var)\s+(\w+)\s*=/gm,                      kind: 'variable'  },
  { re: /^(?:export\s+default\s+)?(?:async\s+)?function\s+(\w+)/gm, kind: 'function' },
  { re: /module\.exports(?:\.(\w+))?\s*=/gm,                     kind: 'export'    },
];

function extractSymbols(content: string): FileSymbol[] {
  const symbols: FileSymbol[] = [];
  const seen = new Set<string>();

  for (const { re, kind } of SYMBOL_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const name = m[1] ?? '(default)';
      const key = `${kind}:${name}`;
      if (!seen.has(key) && name.length > 1) {
        seen.add(key);
        // Contar líneas hasta el match para aproximar el número de línea.
        const line = content.slice(0, m.index).split('\n').length;
        symbols.push({ kind, name, line });
      }
    }
  }
  return symbols;
}

// ── Tokenización para BM25 ────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'in', 'it', 'of', 'to', 'and', 'or', 'not', 'for',
  'this', 'that', 'with', 'from', 'as', 'be', 'by', 'on', 'at', 'if', 'else',
  'return', 'const', 'let', 'var', 'function', 'class', 'import', 'export',
  'module', 'require', 'true', 'false', 'null', 'undefined', 'new', 'throw',
  'try', 'catch', 'async', 'await', 'type', 'interface', 'extends', 'implements',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    // Divide en palabras alfanuméricas + camelCase split.
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/\W+/)
    .filter(t => t.length >= 3 && !STOP_WORDS.has(t));
}

function termFrequency(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  return freq;
}

// ── Crawl de archivos ────────────────────────────────────────────────────────

function crawlFiles(dir: string, root: string, results: FileEntry[]): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) crawlFiles(path.join(dir, entry.name), root, results);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!SOURCE_EXTENSIONS.has(ext)) continue;

    const fullPath = path.join(dir, entry.name);
    let content: string;
    try {
      const stat = fs.statSync(fullPath);
      if (stat.size > MAX_FILE_BYTES) continue;
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch { continue; }

    const tokens = tokenize(content);
    const termFreq = termFrequency(tokens);
    const symbols = extractSymbols(content);
    results.push({
      relPath: path.relative(root, fullPath),
      symbols,
      termFreq,
      totalTerms: tokens.length,
    });
  }
}

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * Construye un RepoMap para un directorio. Indexa todos los archivos de código
 * fuente y precalcula IDF para búsqueda eficiente.
 */
export function buildRepoMap(root: string): RepoMap {
  const files: FileEntry[] = [];
  crawlFiles(root, root, files);

  // IDF = log(N / df(t) + 1) + 1 — suavizado para términos raros.
  const N = files.length || 1;
  const df = new Map<string, number>();
  for (const f of files) {
    for (const term of f.termFreq.keys()) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [term, count] of df) {
    idf.set(term, Math.log(N / count + 1) + 1);
  }

  return { root, files, idf };
}

/**
 * Busca los archivos más relevantes para un query usando BM25 simplificado.
 * @param map   RepoMap construido con buildRepoMap()
 * @param query Descripción del bug o tarea de localización
 * @param topK  Número máximo de resultados (default 5)
 */
export function searchRepoMap(map: RepoMap, query: string, topK = 5): SearchResult[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0 || map.files.length === 0) return [];

  const k1 = 1.5, b = 0.75;
  const avgDl = map.files.reduce((s, f) => s + f.totalTerms, 0) / map.files.length;

  const scored = map.files.map(file => {
    let score = 0;
    const matched = new Set<string>();

    for (const term of queryTokens) {
      const tf = file.termFreq.get(term) ?? 0;
      if (tf === 0) continue;
      const idfVal = map.idf.get(term) ?? 1;
      const dl = file.totalTerms;
      const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgDl)));
      score += idfVal * tfNorm;
      matched.add(term);
    }

    // Bonus por coincidencia de símbolos con el query.
    const matchedSymbols: string[] = [];
    for (const sym of file.symbols) {
      const symTokens = tokenize(sym.name);
      if (symTokens.some(t => queryTokens.includes(t)) || queryTokens.some(t => sym.name.toLowerCase().includes(t))) {
        score += 2.0;
        matchedSymbols.push(sym.name);
      }
    }

    return { file, score, matchedSymbols: [...new Set(matchedSymbols)] };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ file, score, matchedSymbols }) => ({
      relPath: file.relPath,
      score: Math.round(score * 100) / 100,
      matchedSymbols,
      snippet: extractSnippet(map.root, file, queryTokens),
    }));
}

/** Extrae un fragmento de contexto relevante (±5 líneas del primer match). */
function extractSnippet(root: string, file: FileEntry, queryTokens: string[]): string {
  const fullPath = path.join(root, file.relPath);
  let content: string;
  try { content = fs.readFileSync(fullPath, 'utf-8'); } catch { return ''; }

  const lines = content.split('\n');
  let bestLine = 0;
  let bestScore = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineTokens = tokenize(lines[i]);
    const score = queryTokens.filter(t => lineTokens.includes(t)).length;
    if (score > bestScore) { bestScore = score; bestLine = i; }
  }

  const start = Math.max(0, bestLine - 5);
  const end = Math.min(lines.length - 1, bestLine + 5);
  return lines.slice(start, end + 1).join('\n');
}

/**
 * Formatea los resultados de búsqueda como texto para el LLM.
 * Listo para inyectar en el contexto del agente.
 */
export function formatSearchResults(results: SearchResult[], query: string): string {
  if (results.length === 0) return `[RepoMap] Sin resultados para: "${query}"`;

  const lines = [`[RepoMap] Top ${results.length} archivos para "${query}":\n`];
  for (const r of results) {
    const syms = r.matchedSymbols.length > 0 ? `  símbolos: ${r.matchedSymbols.join(', ')}` : '';
    lines.push(`${r.relPath}  (score=${r.score})${syms}`);
    if (r.snippet) lines.push(`  ···\n${r.snippet.split('\n').map(l => '  ' + l).join('\n')}\n  ···`);
  }
  return lines.join('\n');
}
