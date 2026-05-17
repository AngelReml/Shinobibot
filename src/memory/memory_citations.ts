/**
 * Memory Citations — formateo determinista de RecallResult[] para mostrar
 * la procedencia de cada memoria recordada.
 *
 * Diferenciador: OpenClaw tiene "memory citations mode" como configurable.
 * Shinobi lo hace por defecto — cada vez que MemoryStore.recall devuelve
 * resultados, el formato incluye id, score, categoría y match type. El
 * usuario puede ir directamente a esa memoria con
 * `/memory show <id>` (cuando exista el slash command).
 *
 * Formatos:
 *   contextSection(results, maxChars) — para inyectar en el system message
 *   inlineCitations(results)          — para anexar al final de una respuesta
 *   citationLine(result)              — utilidad para una sola memoria
 */

import type { RecallResult } from './types.js';

export interface CitationFormatOptions {
  /** Trunca el content de cada cita a este número de chars (default 220). */
  contentCap?: number;
  /** Decimales para el score (default 2). */
  scorePrecision?: number;
}

const DEFAULTS: Required<CitationFormatOptions> = {
  contentCap: 220,
  scorePrecision: 2,
};

function truncate(s: string, cap: number): string {
  if (s.length <= cap) return s;
  return s.slice(0, cap).trimEnd() + '…';
}

function safeFloat(n: number, decimals: number): string {
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(decimals);
}

/**
 * Devuelve una línea por cita en formato:
 *   - [memory:<id> score=0.87 cat=<cat> match=semantic] <content truncado>
 */
export function citationLine(r: RecallResult, opts: CitationFormatOptions = {}): string {
  const o = { ...DEFAULTS, ...opts };
  const id = r.entry.id;
  const score = safeFloat(r.score, o.scorePrecision);
  const cat = r.entry.category || 'general';
  const match = r.match_type;
  const content = truncate(r.entry.content || '', o.contentCap);
  return `- [memory:${id} score=${score} cat=${cat} match=${match}] ${content}`;
}

/**
 * Construye el bloque de citations a inyectar en el system message,
 * respetando el cap total de chars.
 */
export function contextSection(
  results: RecallResult[],
  maxChars = 2000,
  opts: CitationFormatOptions = {},
): string {
  if (!results || results.length === 0) return '';
  const header = '## Relevant memories from past interactions\n\n';
  const footer = '\n_Sources tagged with `[memory:<id>]` — the user can run `/memory show <id>` to inspect or `/memory forget <id>` to delete._\n';
  let body = '';
  let used = header.length + footer.length;
  for (const r of results) {
    const line = citationLine(r, opts) + '\n';
    if (used + line.length > maxChars) break;
    body += line;
    used += line.length;
  }
  if (!body) return '';
  return header + body + footer;
}
