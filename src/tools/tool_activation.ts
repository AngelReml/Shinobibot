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

/**
 * Núcleo siempre anunciado: lo mínimo para trabajar y para DESCUBRIR el resto
 * (tool_search). El largo tail (browser, windows pack, screen, n8n, committee,
 * generadores, voz, skills…) queda diferido hasta que se busca.
 */
export const CORE_TOOLS: readonly string[] = [
  'tool_search',
  'read_file', 'write_file', 'edit_file', 'list_dir', 'search_files',
  'run_command', 'web_search', 'memory_tool', 'spawn_agent',
];

let _activated = new Set<string>();

/** True si el modo deferred está activo (opt-in por env). */
export function isDeferredMode(): boolean {
  return process.env.SHINOBI_DEFERRED_TOOLS === '1';
}

/** Resetea el conjunto activado al núcleo (al arrancar una misión). */
export function resetActivatedTools(core: readonly string[] = CORE_TOOLS): void {
  _activated = new Set(core);
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
  opts: { deferred: boolean; activated: Set<string>; core?: readonly string[] },
): Tool[] {
  if (!opts.deferred) return allTools;
  const keep = new Set<string>([...(opts.core ?? CORE_TOOLS), ...opts.activated]);
  return allTools.filter((t) => keep.has(t.name));
}

/** Hint de sistema que se inyecta en modo deferred para que el agente busque. */
export const DEFERRED_TOOLS_HINT =
  'HERRAMIENTAS DIFERIDAS: solo ves un núcleo de herramientas. Hay muchas más ' +
  '(navegador, sistema, documentos, etc.). Si necesitas algo que no está en tu ' +
  'lista, llama a `tool_search` con lo que quieres hacer; las herramientas que ' +
  'encuentre quedarán disponibles en los turnos siguientes.';
