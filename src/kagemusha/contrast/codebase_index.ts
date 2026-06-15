/**
 * kagemusha/contrast/codebase_index.ts — index of the repo's own capabilities
 * (dossier §9.1). The LSP today only does diagnostics (no symbol lister), so this
 * is NEW: a lightweight exported-symbol extractor + a CodebaseUnit per symbol. The
 * capability_summary is deterministic by default (kind + signature); an injectable
 * summarizer can enrich it with the cheap LLM. Cached by file hash by the caller.
 */

import * as crypto from 'node:crypto';
import type { CodebaseUnit } from '../types.js';

export interface SymbolEntry { symbol: string; kind: 'function' | 'class' | 'interface' | 'const' | 'type'; line: number; }

const PATTERNS: { re: RegExp; kind: SymbolEntry['kind'] }[] = [
  { re: /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: 'function' },
  { re: /^export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class' },
  { re: /^export\s+interface\s+([A-Za-z_$][\w$]*)/, kind: 'interface' },
  { re: /^export\s+type\s+([A-Za-z_$][\w$]*)/, kind: 'type' },
  { re: /^export\s+const\s+([A-Za-z_$][\w$]*)/, kind: 'const' },
];

/** List exported symbols of a TS/JS source file. Deterministic, no compiler dep. */
export function listExportedSymbols(content: string): SymbolEntry[] {
  const out: SymbolEntry[] = [];
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimStart();
    for (const { re, kind } of PATTERNS) {
      const m = re.exec(line);
      if (m) { out.push({ symbol: m[1], kind, line: i + 1 }); break; }
    }
  }
  return out;
}

export interface IndexInput { path: string; content: string; }
export type Summarizer = (path: string, symbol: SymbolEntry, content: string) => string;

/** Build a CodebaseUnit[] index from source files. `summarize` defaults to a
 *  deterministic one-liner; inject an LLM-backed one for richer summaries. */
export function buildCodebaseIndex(files: IndexInput[], summarize?: Summarizer): CodebaseUnit[] {
  const units: CodebaseUnit[] = [];
  for (const f of files) {
    for (const sym of listExportedSymbols(f.content)) {
      const capability_summary = summarize ? summarize(f.path, sym, f.content) : `${sym.kind} ${sym.symbol} in ${f.path}`;
      units.push({
        unit_id: crypto.createHash('sha256').update(`${f.path}#${sym.symbol}`).digest('hex').slice(0, 16),
        path: f.path, symbol: sym.symbol, capability_summary,
      });
    }
  }
  return units;
}
