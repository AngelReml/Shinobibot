/**
 * Pieza 3 — Consulta contextual.
 *
 *   ask(query)        → top items con tag sentinel ordenados por score
 *                       + resumen de 2 frases.
 *   deepExtract(path) → lee el raw .md completo y extrae una propuesta
 *                       estructurada con LLM (título, descripción,
 *                       área, esfuerzo, riesgos, link).
 *   listArchived(dir, since) → items archivados sin procesar (auditoría).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import type { MemoryProvider } from '../memory/providers/types.js';
import { isSentinelHit } from './indexer.js';
import type { SentinelProposal } from './types.js';

export interface AskHit {
  itemId: string;
  sourceName: string;
  title: string;
  url: string;
  score: number;
  /** Resumen de 2 frases del contenido. */
  summary: string;
}

/** Resumen naïve sin LLM: las 2 primeras frases del texto. */
export function twoSentenceSummary(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.slice(0, 2).join(' ').slice(0, 280);
}

/** /sentinel ask — búsqueda semántica en items tag sentinel. */
export async function ask(
  provider: MemoryProvider,
  query: string,
  k: number = 8,
): Promise<AskHit[]> {
  // Pedimos más de k porque filtramos por tag después.
  const hits = await provider.recall(query, k * 3);
  return hits
    .filter((h) => isSentinelHit(h.message.metadata))
    .slice(0, k)
    .map((h): AskHit => {
      const m = h.message.metadata ?? {};
      const content = h.message.content ?? '';
      // El content es "título\n\ntexto"; el resumen sale del texto.
      const body = content.includes('\n\n') ? content.split('\n\n').slice(1).join('\n\n') : content;
      return {
        itemId: String(m.itemId ?? h.message.id ?? ''),
        sourceName: String(m.sourceName ?? '?'),
        title: String(m.title ?? content.split('\n')[0] ?? '(item)'),
        url: String(m.url ?? ''),
        score: h.score,
        summary: twoSentenceSummary(body),
      };
    });
}

/** Front-matter parseado de un raw .md. */
interface RawDoc {
  meta: Record<string, string>;
  body: string;
}

function parseRawMd(text: string): RawDoc {
  const meta: Record<string, string> = {};
  let body = text;
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (m) {
    for (const line of m[1].split('\n')) {
      const idx = line.indexOf(':');
      if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    body = m[2];
  }
  return { meta, body: body.trim() };
}

export type ProposalLLM = (prompt: string) => Promise<string>;

/**
 * /sentinel deep — lee el raw completo y extrae una propuesta
 * estructurada. `llmFn` inyectable; sin él, hace una extracción
 * heurística degradada.
 */
export async function deepExtract(
  rawPath: string,
  llmFn?: ProposalLLM,
): Promise<SentinelProposal> {
  if (!existsSync(rawPath)) {
    throw new Error(`raw item no encontrado: ${rawPath}`);
  }
  const { meta, body } = parseRawMd(readFileSync(rawPath, 'utf-8'));
  const proposalId = 'prop_' + randomBytes(5).toString('hex');
  const sourceLink = meta.url || '';

  if (llmFn) {
    const prompt = [
      'Lee el siguiente item de vigilancia tecnológica y extrae una propuesta',
      'de mejora potencial para Shinobi (agente autónomo Windows-native).',
      'Responde SOLO JSON con: title, description (3 frases), shinobiArea,',
      'effort (S|M|L|XL), risks (array de strings).',
      '',
      `Título: ${meta.title ?? ''}`,
      `Contenido:\n${body.slice(0, 4000)}`,
    ].join('\n');
    try {
      const raw = await llmFn(prompt);
      const json = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '').trim());
      return {
        proposalId,
        itemId: meta.itemId ?? '',
        title: String(json.title ?? meta.title ?? '(propuesta)'),
        description: String(json.description ?? ''),
        shinobiArea: String(json.shinobiArea ?? 'no determinada'),
        effort: ['S', 'M', 'L', 'XL'].includes(json.effort) ? json.effort : 'M',
        risks: Array.isArray(json.risks) ? json.risks.map(String) : [],
        sourceLink,
        createdAt: new Date().toISOString(),
      };
    } catch {
      /* cae a la extracción heurística */
    }
  }

  // Heurística degradada (sin LLM o si el LLM falló).
  return {
    proposalId,
    itemId: meta.itemId ?? '',
    title: meta.title?.replace(/^"|"$/g, '') ?? '(propuesta)',
    description: twoSentenceSummary(body),
    shinobiArea: 'no determinada (extracción sin LLM)',
    effort: 'M',
    risks: ['Propuesta extraída sin LLM — revisar manualmente.'],
    sourceLink,
    createdAt: new Date().toISOString(),
  };
}

/** /sentinel list — items archivados desde una fecha (YYYY-MM-DD). */
export function listArchived(rawDir: string, sinceDate: string): Array<{
  date: string; sourceId: string; itemId: string; path: string; title: string;
}> {
  if (!existsSync(rawDir)) return [];
  const out: Array<{ date: string; sourceId: string; itemId: string; path: string; title: string }> = [];
  for (const date of readdirSync(rawDir).sort()) {
    if (date < sinceDate) continue;
    const dateDir = join(rawDir, date);
    if (!statSync(dateDir).isDirectory()) continue;
    for (const src of readdirSync(dateDir)) {
      const srcDir = join(dateDir, src);
      if (!statSync(srcDir).isDirectory()) continue;
      for (const file of readdirSync(srcDir)) {
        if (!file.endsWith('.md')) continue;
        const path = join(srcDir, file);
        const { meta } = parseRawMd(readFileSync(path, 'utf-8'));
        out.push({
          date,
          sourceId: meta.sourceId ?? src,
          itemId: meta.itemId ?? file.replace(/\.md$/, ''),
          path,
          title: (meta.title ?? file).replace(/^"|"$/g, ''),
        });
      }
    }
  }
  return out;
}
