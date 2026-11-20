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
import { activateTools, isMcpTool, isMcpEager } from './tool_activation.js';

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
  // Subcadena solo entre palabras de 4+ letras: si no, "on" (de act_on_…) casa
  // con "electron" o "application" y cuela herramientas que no tienen nada que ver.
  return bag.some((w) => w === token || (token.length >= 4 && w.includes(token)) || (w.length >= 4 && token.includes(w)));
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

/** Tools de un servidor MCP concreto (prefijo `mcp__<server>__`), o todas si no se pide servidor. */
export function scopeToServer(tools: Tool[], server?: string): Tool[] {
  const srv = (server ?? '').trim().replace(/[^a-zA-Z0-9_]+/g, '_');
  if (!srv) return tools;
  return tools.filter((t) => t.name.startsWith(`mcp__${srv}__`));
}

/**
 * Resuelve nombres EXACTOS contra el registry. Acepta el nombre completo
 * (`mcp__rea__open_binary`) o el nombre corto de una tool MCP (`open_binary`),
 * que es como lo escriben las skills. Un nombre corto ambiguo entre dos
 * servidores no se resuelve (hay que dar `server` o el nombre completo).
 */
export function resolveToolNames(names: string[], tools: Tool[]): { found: string[]; missing: string[] } {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const found: string[] = [];
  const missing: string[] = [];
  for (const raw of names) {
    const n = String(raw ?? '').trim();
    if (!n) continue;
    if (byName.has(n)) { found.push(n); continue; }
    const short = tools.filter((t) => isMcpTool(t) && t.name.endsWith(`__${n}`));
    if (short.length === 1) found.push(short[0].name);
    else missing.push(n);
  }
  return { found: [...new Set(found)], missing };
}

/** Cuántas fichas completas (con esquema) devuelve una búsqueda; el resto va en una línea. */
export const MCP_CARDS_PER_SEARCH = 3;
/** Presupuesto de caracteres para las fichas de una respuesta (bajo el tope general de 32.000). */
export const MCP_CARDS_BUDGET = 24_000;

function shortMcpName(full: string): string {
  const m = /^mcp__(.+?)__(.+)$/.exec(full);
  return m ? `${m[2]} (server ${m[1]})` : full;
}

/**
 * Fichas de tools MCP para que el agente pueda llamarlas con `mcp_call` sin que
 * estén anunciadas: nombre, descripción completa y esquema JSON de argumentos.
 * Reparte el presupuesto entre las fichas; si una no cabe, lo dice.
 */
export function describeMcpTools(tools: Tool[], budget: number): string {
  if (tools.length === 0) return '';
  const each = Math.max(1500, Math.floor(budget / tools.length));
  const cards = tools.map((t) => {
    const m = /^mcp__(.+?)__(.+)$/.exec(t.name);
    const desc = t.description.replace(/^\[MCP:[^\]]*\]\s*/, '');
    const schema = JSON.stringify(t.parameters);
    let body = `descripción: ${desc}\nargumentos (JSON Schema): ${schema}`;
    if (body.length > each) body = body.slice(0, each) + `\n[ficha recortada: pídela sola con names=["${m?.[2] ?? t.name}"] para verla entera]`;
    return `### ${m?.[2] ?? t.name}\nllamada: mcp_call({"server":"${m?.[1] ?? ''}","tool":"${m?.[2] ?? t.name}","args":{…}})\n${body}`;
  });
  return ['Herramientas MCP (no están en tu lista: se llaman con `mcp_call`):', ...cards].join('\n\n');
}

const toolSearchTool: Tool = {
  name: 'tool_search',
  description:
    'Busca entre las herramientas disponibles las más adecuadas para una tarea, ' +
    'ordenadas por relevancia Y por su fiabilidad probada (historial de éxito). ' +
    'Úsalo cuando no estés seguro de qué herramienta usar. Sin query, lista las ' +
    'más fiables. También encuentra las herramientas de servidores MCP (no ' +
    'anunciadas): con `server` + `query`, o con `names` si ya sabes los nombres ' +
    'exactos; devuelve su esquema para llamarlas con `mcp_call`. Read-only.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Qué quieres hacer (p. ej. "leer un fichero", "buscar en la web").' },
      limit: { type: 'number', description: 'Máximo de resultados (default 10).' },
      server: { type: 'string', description: 'Limitar la búsqueda a un servidor MCP conectado (p. ej. "rea").' },
      names: { type: 'array', items: { type: 'string' }, description: 'Nombres exactos de los que quieres la ficha, sin buscar (completos o cortos, p. ej. ["open_binary"]).' },
    },
  },
  categories: ['research'],

  async execute(args: { query?: string; limit?: number; server?: string; names?: string[] }): Promise<ToolResult> {
    const pool = scopeToServer(getAllTools(), args.server);
    if (args.server && pool.length === 0) {
      return { success: false, output: '', error: `No hay ningún servidor MCP conectado con el nombre "${args.server}".` };
    }
    const eager = isMcpEager();
    // Por nombre exacto (lo que una skill ya sabe): devuelve la ficha completa.
    if (Array.isArray(args.names) && args.names.length > 0) {
      const { found, missing } = resolveToolNames(args.names, pool);
      const byName = new Map(pool.map((t) => [t.name, t]));
      activateTools(found.filter((n) => eager || !n.startsWith('mcp__')));
      const out: string[] = [];
      const mcp = found.filter((n) => n.startsWith('mcp__') && !eager);
      const rest = found.filter((n) => !mcp.includes(n));
      if (mcp.length) out.push(describeMcpTools(mcp.map((n) => byName.get(n)!), MCP_CARDS_BUDGET));
      if (rest.length) out.push(`Disponibles: ${rest.join(', ')}`);
      if (missing.length) out.push(`No encontradas (${missing.length}): ${missing.join(', ')}. Prueba con \`query\`.`);
      return { success: found.length > 0, output: out.join('\n'), error: found.length ? undefined : out.join(' ') };
    }
    const report = loadTrustReport();
    const matches = searchTools(args.query ?? '', pool, report, { limit: args.limit });
    if (matches.length === 0) {
      return { success: true, output: `No hay herramientas que casen con "${args.query ?? ''}".` };
    }
    // Modo deferred: las tools NATIVAS encontradas quedan anunciadas en los turnos
    // siguientes. Las MCP no se anuncian nunca (salvo eager): se llaman con mcp_call.
    activateTools(matches.map((m) => m.name).filter((n) => eager || !n.startsWith('mcp__')));
    const byName = new Map(pool.map((t) => [t.name, t]));
    const mcpHits = eager ? [] : matches.filter((m) => m.name.startsWith('mcp__'));
    const lines = matches.filter((m) => !mcpHits.includes(m)).map((m) => {
      const trustPct = Math.round(m.trust * 100);
      return `- ${m.name} (rel ${m.relevance.toFixed(2)}, trust ${trustPct}%): ${m.description.slice(0, 100)}`;
    });
    const out: string[] = [];
    if (lines.length) out.push(`Herramientas para "${args.query ?? '(todas)'}":`, ...lines);
    if (mcpHits.length) {
      // Ficha completa (con esquema) de las mejores; del resto, una línea.
      const top = mcpHits.slice(0, MCP_CARDS_PER_SEARCH).map((m) => byName.get(m.name)!);
      out.push(describeMcpTools(top, MCP_CARDS_BUDGET));
      const more = mcpHits.slice(MCP_CARDS_PER_SEARCH);
      if (more.length) {
        out.push('Otras que casan (pide su ficha con `names`):', ...more.map((m) => `- ${shortMcpName(m.name)}: ${m.description.replace(/^\[MCP:[^\]]*\]\s*/, '').replace(/\s+/g, ' ').slice(0, 160)}`));
      }
    }
    return { success: true, output: out.join('\n') };
  },
};

registerTool(toolSearchTool);
export default toolSearchTool;
