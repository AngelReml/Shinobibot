// src/documents/factory.ts
//
// Bloque 5 — factory + auto-detección + helper de auto-oferta.
//
// Generación bloqueante con shape unificada. El LLM o un slash command pasa
// `{type, title, content_md|content_table}` y el factory dispatcha al
// generador correcto. Salida en `./outputs/<timestamp>_<slug>.<ext>` (override
// con env SHINOBI_OUTPUT_DIR).

import * as fs from 'fs';
import * as path from 'path';
import { generateMarkdown } from './markdown.js';
import { generateWord } from './word.js';
import { generatePdf } from './pdf.js';
import { generateExcel, type ExcelFormula } from './excel.js';

export type DocType = 'word' | 'pdf' | 'excel' | 'markdown';

export interface DocumentRequest {
  /** 'auto' triggers heuristic detection from `instruction` + content shape. */
  type: DocType | 'auto';
  title: string;
  content_md?: string;
  content_table?: {
    headers: string[];
    rows: (string | number)[][];
    formulas?: ExcelFormula[];
  };
  /** Free-form natural language used by `auto` heuristics (and ignored otherwise). */
  instruction?: string;
}

export interface DocumentResult {
  type: DocType;
  path: string;
  bytes: number;
  title: string;
}

// ─── Event listener (server.ts broadcasts to WS clients) ──────────────────

export interface DocumentEvent {
  type: 'document_generated' | 'document_offer';
  doc?: DocumentResult;
  hint?: string;
}

let listener: ((e: DocumentEvent) => void) | null = null;
export function setDocumentEventListener(fn: ((e: DocumentEvent) => void) | null): void {
  listener = fn;
}
function emit(e: DocumentEvent): void {
  try { listener?.(e); } catch { /* ignore */ }
}

const EXT: Record<DocType, string> = {
  word: 'docx',
  pdf: 'pdf',
  excel: 'xlsx',
  markdown: 'md',
};

function slugify(s: string): string {
  return (s || 'documento')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'documento';
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function getOutputDir(): string {
  return process.env.SHINOBI_OUTPUT_DIR || path.join(process.cwd(), 'outputs');
}

function buildOutputPath(type: DocType, title: string): string {
  const dir = getOutputDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fname = `${timestamp()}_${slugify(title)}.${EXT[type]}`;
  return path.join(dir, fname);
}

/**
 * Heuristic auto-detect from natural language. Pure substring + keyword
 * matching, deterministic and fast (no LLM round-trip).
 *
 * Priority: explicit format keyword > tabular signal > document signal > md fallback.
 */
export function detectType(instruction: string, hasTable: boolean = false): DocType {
  const s = (instruction || '').toLowerCase();

  // Explicit format keywords first.
  if (/\b(\.?xlsx|excel|hoja\s+de\s+c[áa]lculo|spreadsheet)\b/.test(s)) return 'excel';
  if (/\b(\.?pdf|imprimir|printable)\b/.test(s)) return 'pdf';
  if (/\b(\.?docx|word|microsoft\s+word)\b/.test(s)) return 'word';
  if (/\b(\.?md|markdown|readme)\b/.test(s)) return 'markdown';

  // Structural signals.
  if (hasTable) return 'excel';
  if (/\b(tabla|columnas|filas|datos\s+(estructurados|tabulares))\b/.test(s)) return 'excel';

  // Document-y signals → word (richer formatting than md).
  if (/\b(informe|reporte|documento|memoria|propuesta|whitepaper)\b/.test(s)) return 'word';

  // Default fallback.
  return 'markdown';
}

export async function generateDocument(req: DocumentRequest): Promise<DocumentResult> {
  const detectedType: DocType = req.type === 'auto'
    ? detectType(req.instruction ?? req.title ?? '', !!req.content_table)
    : req.type;

  const title = req.title?.trim() || 'Documento sin título';
  const outputPath = buildOutputPath(detectedType, title);

  if (detectedType === 'excel') {
    if (!req.content_table) {
      throw new Error('excel requires content_table { headers, rows, formulas? }');
    }
    const r = await generateExcel({ title, content_table: req.content_table, outputPath });
    const out: DocumentResult = { type: detectedType, path: r.path, bytes: r.bytes, title };
    emit({ type: 'document_generated', doc: out });
    return out;
  }

  // word/pdf/markdown share content_md.
  const content_md = req.content_md ?? (req.content_table
    ? tableToMarkdown(req.content_table)
    : '');

  if (!content_md.trim()) {
    throw new Error(`${detectedType} requires content_md (or content_table for excel)`);
  }

  let r: { path: string; bytes: number };
  if (detectedType === 'word') r = await generateWord({ title, content_md, outputPath });
  else if (detectedType === 'pdf') r = await generatePdf({ title, content_md, outputPath });
  else r = await generateMarkdown({ title, content_md, outputPath });

  const result: DocumentResult = { type: detectedType, path: r.path, bytes: r.bytes, title };
  emit({ type: 'document_generated', doc: result });
  return result;
}

export function offerDocument(hint: string): void {
  emit({ type: 'document_offer', hint });
}

function tableToMarkdown(table: { headers: string[]; rows: (string | number)[][] }): string {
  const lines: string[] = [];
  lines.push(`| ${table.headers.join(' | ')} |`);
  lines.push(`| ${table.headers.map(() => '---').join(' | ')} |`);
  for (const row of table.rows) {
    lines.push(`| ${row.map(c => String(c ?? '')).join(' | ')} |`);
  }
  return lines.join('\n');
}

// ─── Auto-offer detector (Bloque 5 hook) ─────────────────────────────────────

const AUTO_OFFER_THRESHOLD = parseInt(process.env.SHINOBI_DOC_AUTO_OFFER_THRESHOLD || '2000', 10);

export function shouldOfferDocument(responseText: string): boolean {
  if (process.env.SHINOBI_DOC_AUTO_OFFER === '0') return false;
  if (!responseText || responseText.length < AUTO_OFFER_THRESHOLD) return false;
  // Structural signals: at least one H1/H2 header OR a markdown table OR
  // multiple ordered/unordered list items.
  const hasH = /^#{1,3}\s+\S/m.test(responseText);
  const hasTable = /^\|[^\n]+\|\s*$/m.test(responseText) && /^\|[\s:-]+\|\s*$/m.test(responseText);
  const listMatches = responseText.match(/^(?:[-*]\s+|\d+\.\s+)\S/mg);
  const hasList = !!listMatches && listMatches.length >= 3;
  return hasH || hasTable || hasList;
}
