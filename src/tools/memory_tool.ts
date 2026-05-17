/**
 * Fase 8 del bucle de aprendizaje — tool `memory`.
 *
 * Hasta ahora el agente solo podía guardar memoria de forma DIFERIDA, vía
 * el background review post-turno. Este tool cierra ese hueco: deja que el
 * agente EN VIVO guarde un hecho declarativo en el momento ("guarda esto",
 * "recuérdalo") — la otra vía que el mapa de Hermes (§1.4) recomienda tener.
 *
 * Escribe a MEMORY.md vía `CuratedMemory.appendEnv()` (que escanea
 * inyección). Pasa por el mismo guard `classifyMemoryEntry` (Fase 3): solo
 * hechos declarativos, nunca directivas imperativas.
 *
 * DECISIÓN DE SEGURIDAD (explícita, no un hueco): este tool NO pasa por el
 * gate de aprobación (`DESTRUCTIVE_TOOLS`). Es coherente con el resto del
 * bucle de aprendizaje — el background review (Fase 1) también escribe a
 * MEMORY.md sin gate; es aprendizaje autónomo por diseño, y el `memory`
 * tool es su versión en vivo. Gatearlo rompería el guardado proactivo
 * ("guarda esto" exigiría además un y/n) y el modo web (asker deny-by-
 * default). Defensa en profundidad en su lugar: (1) cap de tamaño — un
 * hecho es una frase corta; (2) `classifyMemoryEntry` — rechaza imperativos;
 * (3) `scanContent` dentro de `appendEnv` — rechaza inyección/exfiltración.
 */

/** Cap de tamaño — un hecho de memoria es UNA frase corta, no un volcado. */
const MAX_MEMORY_ENTRY_CHARS = 400;

import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { curatedMemory } from '../memory/curated_memory.js';
import { classifyMemoryEntry } from '../learning/memory_separation.js';

const memoryTool: Tool = {
  name: 'memory',
  description:
    'Save a durable fact to persistent memory (MEMORY.md), injected into ' +
    'future turns. Do this PROACTIVELY, without waiting to be asked, when:\n' +
    '- the user corrects you or says "remember this" / "don\'t do that again"\n' +
    '- the user shares a preference, habit, or personal detail (name, role, ' +
    'timezone, coding style)\n' +
    '- you learn a stable fact about the environment or the user\'s setup.\n\n' +
    'Write a DECLARATIVE FACT, not an instruction to yourself: ' +
    '"User prefers concise responses" — correct. "Always be concise" — ' +
    'rejected (an imperative re-reads as a directive and overrides the ' +
    'user\'s actual request).\n' +
    'Do NOT save task progress, PR numbers, commit SHAs, or anything that ' +
    'will be stale in 7 days. For procedures use request_new_skill instead.',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The declarative fact to remember. One short sentence.',
      },
    },
    required: ['content'],
  },

  async execute(args: { content?: string }): Promise<ToolResult> {
    const content = typeof args?.content === 'string' ? args.content.trim() : '';
    if (!content) {
      return { success: false, output: '', error: 'content is required' };
    }
    if (content.length > MAX_MEMORY_ENTRY_CHARS) {
      return {
        success: false, output: '',
        error: `content too long (${content.length} chars) — a memory entry must ` +
          `be ONE short fact (<=${MAX_MEMORY_ENTRY_CHARS} chars). Save only the durable fact.`,
      };
    }
    // Guard de la Fase 3 — solo hechos declarativos entran a memoria.
    const cls = classifyMemoryEntry(content);
    if (!cls.ok) {
      return {
        success: false, output: '',
        error: `not saved — ${cls.reason}. Rephrase as a declarative fact.`,
      };
    }
    try {
      const r = curatedMemory().appendEnv(content);
      if (r.ok) {
        return { success: true, output: `Saved to memory: "${content.slice(0, 80)}"` };
      }
      return { success: false, output: '', error: r.message };
    } catch (e: any) {
      return { success: false, output: '', error: `memory write failed: ${e?.message ?? e}` };
    }
  },
};

registerTool(memoryTool);
export default memoryTool;
