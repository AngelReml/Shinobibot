// src/tools/tool_activation.ts
//
// MODO DEFERRED-TOOLS — el payoff de ToolSearch.
//
// Por defecto el orchestrator anuncia las ~46 tools en CADA turno (prompt
// inflado, más coste/latencia, y no escala a cientos de tools/MCP). En modo
// deferred (opt-in `SHINOBI_DEFERRED_TOOLS=1`), solo se anuncia un NÚCLEO + la
// herramienta `tool_search`; el agente busca lo que necesita y las tools
// encontradas se ACTIVAN para los turnos siguientes.
//
// El acceso NO cambia: el orchestrator puede ejecutar cualquier tool por nombre.
// Lo que cambia es qué se ANUNCIA al modelo (tamaño del prompt). Por eso es
// seguro: en el peor caso el agente llama una tool no anunciada y se ejecuta.
//
// El estado de activación es un singleton por proceso: válido porque el
// orchestrator serializa las misiones (mutex `busy`). Se resetea por misión.

import type { Tool } from './tool_registry.js';
import { rankToolNamesByTrust, type TrustReport } from '../audit/trust_ledger.js';

/**
 * Núcleo siempre anunciado: lo mínimo para trabajar y para DESCUBRIR el resto
 * (tool_search). El largo tail (browser, windows pack, screen, n8n, committee,
 * generadores, voz, skills…) queda diferido hasta que se busca.
 */
export const CORE_TOOLS: readonly string[] = [
  'tool_search',
  'read_file', 'write_file', 'edit_file', 'list_dir', 'search_files',
  'run_command', 'web_search', 'memory_tool', 'spawn_agent',
  'todo', 'clarify', 'session_search', 'skill_use',
];

let _activated = new Set<string>();

/** True si el modo deferred está activo (opt-in por env). */
export function isDeferredMode(): boolean {
  return process.env.SHINOBI_DEFERRED_TOOLS === '1';
}

/** ¿Es una tool traída por un servidor MCP? (nombre `mcp__<server>__<tool>`). */
export function isMcpTool(t: { name: string; categories?: string[] }): boolean {
  return t.name.startsWith('mcp__') || (t.categories ?? []).includes('mcp');
}

/**
 * ¿Se anuncian TODAS las tools MCP de golpe? Por defecto NO: van "en el cajón"
 * y solo se anuncian las que `tool_search` haya sacado. Un servidor grande
 * (REA: 263 tools, ~350 KB de esquemas) inflaría cada turno en decenas de miles
 * de tokens. `SHINOBI_MCP_EAGER=1` restaura el anuncio completo.
 */
export function isMcpEager(): boolean {
  return process.env.SHINOBI_MCP_EAGER === '1';
}

/**
 * Resetea el conjunto activado al núcleo (al arrancar una misión). Las tools
 * MCP ya sacadas del cajón se CONSERVAN: valen para toda la sesión, así no hay
 * que volver a buscarlas en cada mensaje.
 */
export function resetActivatedTools(core: readonly string[] = CORE_TOOLS): void {
  const keptMcp = [..._activated].filter((n) => n.startsWith('mcp__'));
  _activated = new Set([...core, ...keptMcp]);
}

/** Retira tools del conjunto activado (p. ej. al desconectar un servidor MCP). */
export function deactivateTools(names: string[]): void {
  for (const n of names) _activated.delete(n);
}

/** Marca tools como activadas (anunciadas en adelante). */
export function activateTools(names: string[]): void {
  for (const n of names) _activated.add(n);
}

/** Conjunto activado actual. */
export function getActivatedTools(): Set<string> {
  return _activated;
}

/**
 * Calcula qué tools ANUNCIAR. Si deferred está OFF, devuelve todas (sin
 * cambio de comportamiento). Si ON, solo las del núcleo + las activadas que
 * existan en el registry. Función PURA (no lee env): el caller pasa `deferred`.
 */
export function computeAdvertisedTools(
  allTools: Tool[],
  opts: { deferred: boolean; activated: Set<string>; core?: readonly string[]; trustReport?: TrustReport; mcpEager?: boolean },
): Tool[] {
  let out = allTools;
  if (opts.deferred) {
    const keep = new Set<string>([...(opts.core ?? CORE_TOOLS), ...opts.activated]);
    out = allTools.filter((t) => keep.has(t.name));
  } else if (!opts.mcpEager) {
    // Cajón MCP: aunque el modo deferred global esté OFF, las tools de
    // servidores MCP solo se anuncian si `tool_search` las ha activado.
    out = allTools.filter((t) => !isMcpTool(t) || opts.activated.has(t.name));
  }
  // E3 cierra el loop: ordena las tools anunciadas por fiabilidad PROBADA (las
  // más fiables primero) — el sustrato de audit influye en lo que el modelo ve.
  // Sin historial, orden estable original (sin cambio de comportamiento).
  if (opts.trustReport && opts.trustReport.tools.length > 0) {
    const rank = new Map(rankToolNamesByTrust(out.map((t) => t.name), opts.trustReport).map((n, i) => [n, i]));
    out = [...out].sort((a, b) => (rank.get(a.name) ?? 0) - (rank.get(b.name) ?? 0));
  }
  return out;
}

/** Hint de sistema que se inyecta en modo deferred para que el agente busque. */
export const DEFERRED_TOOLS_HINT =
  'HERRAMIENTAS DIFERIDAS: solo ves un núcleo de herramientas. Hay muchas más ' +
  '(navegador, sistema, documentos, etc.). Si necesitas algo que no está en tu ' +
  'lista, llama a `tool_search` con lo que quieres hacer; las herramientas que ' +
  'encuentre quedarán disponibles en los turnos siguientes.';

/**
 * Hint de sistema del cajón MCP: una línea por servidor conectado, para que el
 * agente sepa que esas herramientas existen sin pagar sus esquemas. '' si no
 * hay servidores (no se inyecta nada).
 */
export function mcpDrawerHint(servers: { name: string; total: number }[]): string {
  const live = servers.filter((s) => s.total > 0);
  if (live.length === 0) return '';
  // Texto ESTABLE entre turnos (sin contadores que cambien) para no romper la caché de prompt.
  const lines = live.map((s) => `- ${s.name}: ${s.total} herramientas`);
  return [
    'SERVIDORES MCP CONECTADOS (sus herramientas NO están en tu lista hasta que las saques):',
    ...lines,
    'Para usar una: `tool_search` con `server` y una `query` de lo que quieres hacer, o con ' +
      '`names` si ya sabes el nombre exacto (p. ej. por una skill). Las que saques quedan ' +
      'disponibles desde el turno siguiente y durante toda la sesión. Saca solo las que vayas a usar.',
  ].join('\n');
}
