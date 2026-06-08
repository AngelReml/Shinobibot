// src/tools/tool_search.ts
//
// ToolSearch SOBRE E3 — descubrimiento de herramientas rankeado por RELEVANCIA
// léxica + FIABILIDAD PROBADA (trust-scores del audit, motor E3).
//
// Es el consumidor natural del sustrato E3 y el cimiento para escalar a cientos
// de tools/MCP sin inflar el prompt: en vez de exponer TODAS, el agente busca
// las que necesita y se le devuelven las más relevantes Y más fiables primero.
// Cierra el bucle "todo aprende del log": una herramienta que falla mucho en la
// práctica baja en el ranking aunque sea léxicamente relevante.

import { type Tool, type ToolResult, registerTool, getAllTools } from './tool_registry.js';
import { loadTrustReport, type TrustReport } from '../audit/trust_ledger.js';

export interface ToolMatch {
  name: string;
  description: string;
  categories?: string[];
  /** Relevancia léxica 0..1 respecto a la query. */
  relevance: number;
  /** Trust-score E3 0..1 (0.5 si la herramienta no tiene historial). */
  trust: number;
  /** Score combinado usado para ordenar. */
  score: number;
}

export interface SearchOptions {
  limit?: number;
  /** Peso del trust en el score combinado (0..1, default 0.25). */
  trustWeight?: number;
}

const STOPWORDS = new Set(['de', 'la', 'el', 'los', 'las', 'un', 'una', 'the', 'a', 'an', 'to', 'of', 'for', 'and', 'con', 'por', 'que', 'me', 'mi']);

function normalize(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(s: string): string[] {
  return normalize(s).split(' ').filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/** ¿`token` casa con alguno de `bag` (substring en cualquier dirección)? */
function hits(token: string, bag: string[]): boolean {
  return bag.some((w) => w === token || w.includes(token) || token.includes(w));
}

/**
 * Busca y rankea herramientas por relevancia + trust (función pura). Devuelve
 * matches con relevancia > 0 ordenados por score. Con query vacía, devuelve
 * TODAS ordenadas por trust (descubrir las más fiables).
 */
export function searchTools(
  query: string,
  tools: Tool[],
  trust: TrustReport,
  opts: SearchOptions = {},
): ToolMatch[] {
  const trustWeight = opts.trustWeight ?? 0.25;
  const limit = opts.limit ?? 10;
  const trustOf = new Map(trust.tools.map((t) => [t.tool, t.score]));
  const qTokens = tokens(query);

  const matches: ToolMatch[] = [];
  for (const tool of tools) {
    const nameTokens = tokens(tool.name);
    const descTokens = tokens(tool.description);
    const catTokens = tokens((tool.categories ?? []).join(' '));
    const ts = trustOf.get(tool.name) ?? 0.5;

    let relevance: number;
    if (qTokens.length === 0) {
      relevance = 1; // sin query, todas valen (se ordenan por trust)
    } else {
      let raw = 0;
      for (const qt of qTokens) {
        if (hits(qt, nameTokens)) raw += 2; // match en nombre pesa más
        else if (hits(qt, descTokens)) raw += 1;
        else if (hits(qt, catTokens)) raw += 1;
      }
      relevance = Math.min(1, raw / (qTokens.length * 2));
    }
    if (relevance <= 0) continue;

    const score = qTokens.length === 0
      ? ts // query vacía → puro trust
      : relevance * (1 - trustWeight) + ts * trustWeight;

    matches.push({
      name: tool.name,
      description: tool.description,
      categories: tool.categories,
      relevance: Number(relevance.toFixed(4)),
      trust: Number(ts.toFixed(4)),
      score: Number(score.toFixed(4)),
    });
  }

  matches.sort((a, b) => b.score - a.score || b.relevance - a.relevance || a.name.localeCompare(b.name));
  return matches.slice(0, limit);
}

const toolSearchTool: Tool = {
  name: 'tool_search',
  description:
    'Busca entre las herramientas disponibles las más adecuadas para una tarea, ' +
    'ordenadas por relevancia Y por su fiabilidad probada (historial de éxito). ' +
    'Úsalo cuando no estés seguro de qué herramienta usar. Sin query, lista las ' +
    'más fiables. Read-only.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Qué quieres hacer (p. ej. "leer un fichero", "buscar en la web").' },
      limit: { type: 'number', description: 'Máximo de resultados (default 10).' },
    },
  },
  categories: ['research'],

  async execute(args: { query?: string; limit?: number }): Promise<ToolResult> {
    const report = loadTrustReport();
    const matches = searchTools(args.query ?? '', getAllTools(), report, { limit: args.limit });
    if (matches.length === 0) {
      return { success: true, output: `No hay herramientas que casen con "${args.query ?? ''}".` };
    }
    const lines = matches.map((m) => {
      const trustPct = Math.round(m.trust * 100);
      return `- ${m.name} (rel ${m.relevance.toFixed(2)}, trust ${trustPct}%): ${m.description.slice(0, 100)}`;
    });
    return { success: true, output: [`Herramientas para "${args.query ?? '(todas)'}":`, ...lines].join('\n') };
  },
};

registerTool(toolSearchTool);
export default toolSearchTool;
