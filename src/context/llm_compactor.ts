/**
 * LLM Compactor — modo opcional que delega la compactación al LLM
 * (igual que Hermes context_compressor.py). Coexiste con el heurístico
 * existente: el modo lo elige el env var SHINOBI_COMPACTOR_MODE:
 *
 *   - 'heuristic' (default): usa compactor.ts (rápido, predecible, gratis)
 *   - 'llm'                : siempre LLM-based (caro pero fidelidad semántica)
 *   - 'auto'               : LLM solo cuando heurístico no es suficiente
 *                            (tokens estimados > budget * autoThreshold)
 *
 * El compactor LLM nunca toca:
 *   - mensajes role:'system' (intactos siempre)
 *   - el último mensaje del usuario
 *   - los últimos N turnos (configurable)
 *
 * Lo que sí hace: produce un summary de los mensajes intermedios y los
 * reemplaza por un único mensaje sintético que mantiene la traza
 * conversacional. Mantiene tool_calls + tool_responses pairing.
 */

import type { CompactionResult } from './compactor.js';

export type CompactorMode = 'heuristic' | 'llm' | 'auto';

export interface LLMCompactorOptions {
  /** Mode override; si no, lee `SHINOBI_COMPACTOR_MODE`. */
  mode?: CompactorMode;
  /** Cuántos turnos finales preservar intactos (default 3). */
  preserveLastTurns?: number;
  /** Threshold para `auto`: dispara LLM cuando est_tokens > budget*this (default 0.85). */
  autoThreshold?: number;
  /** Budget de tokens total (default 32k). */
  budgetTokens?: number;
  /** LLM caller — async function que recibe el prompt de summary y devuelve texto. */
  llmFn?: (prompt: string) => Promise<string>;
}

const DEFAULT_OPTS: Required<Omit<LLMCompactorOptions, 'llmFn'>> = {
  mode: 'heuristic',
  preserveLastTurns: 3,
  autoThreshold: 0.85,
  budgetTokens: 32_000,
};

export function resolveMode(envVal?: string, override?: CompactorMode): CompactorMode {
  const value = (override ?? envVal ?? 'heuristic') as CompactorMode;
  if (value === 'heuristic' || value === 'llm' || value === 'auto') return value;
  return 'heuristic';
}

function estimateTokens(messages: any[]): number {
  let chars = 0;
  for (const m of messages) {
    if (typeof m?.content === 'string') chars += m.content.length;
    else if (Array.isArray(m?.content)) {
      for (const part of m.content) {
        if (typeof part?.text === 'string') chars += part.text.length;
      }
    }
  }
  return Math.ceil(chars / 4);
}

function buildSummaryPrompt(messagesToSummarize: any[]): string {
  const lines: string[] = [];
  lines.push('Resume la siguiente conversación entre user y assistant en máximo 8 puntos clave.');
  lines.push('Preserva: decisiones tomadas, hechos confirmados, tools ejecutadas (no args).');
  lines.push('Descarta: small talk, retries, errores ya resueltos.');
  lines.push('Formato: lista con guiones, español.');
  lines.push('');
  lines.push('--- Conversación ---');
  for (const m of messagesToSummarize) {
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    lines.push(`${m.role}: ${text.slice(0, 800)}`);
  }
  lines.push('--- fin ---');
  return lines.join('\n');
}

/**
 * Decide si debe correrse el LLM compactor según el modo + tokens
 * estimados.
 */
export function shouldUseLLM(
  messages: any[],
  opts: LLMCompactorOptions = {}
): { useLLM: boolean; estTokens: number; mode: CompactorMode } {
  const mode = resolveMode(process.env.SHINOBI_COMPACTOR_MODE, opts.mode);
  const budget = opts.budgetTokens ?? DEFAULT_OPTS.budgetTokens;
  const threshold = opts.autoThreshold ?? DEFAULT_OPTS.autoThreshold;
  const estTokens = estimateTokens(messages);

  if (mode === 'heuristic') return { useLLM: false, estTokens, mode };
  if (mode === 'llm') return { useLLM: true, estTokens, mode };
  // auto:
  return { useLLM: estTokens > budget * threshold, estTokens, mode };
}

/**
 * Ejecuta la compactación LLM. Si `llmFn` no se inyecta, devuelve
 * `compacted=false` con un error legible (no rompe — el caller hace
 * fallback al heurístico).
 */
export async function compactWithLLM(
  messages: any[],
  opts: LLMCompactorOptions = {}
): Promise<CompactionResult & { method: 'llm' | 'skipped'; error?: string }> {
  const preserve = opts.preserveLastTurns ?? DEFAULT_OPTS.preserveLastTurns;
  const beforeTokens = estimateTokens(messages);

  if (!opts.llmFn) {
    return {
      messages,
      compacted: false,
      beforeTokens,
      afterTokens: beforeTokens,
      truncatedCount: 0,
      droppedCount: 0,
      method: 'skipped',
      error: 'llmFn no inyectada — el caller debe pasar una función LLM',
    };
  }

  // Partición: system + middle + lastNTurns.
  const systemMsgs = messages.filter(m => m.role === 'system');
  const nonSystem = messages.filter(m => m.role !== 'system');

  // Identifica turnos: un "turno" = user message + cualquier
  // assistant/tool hasta el siguiente user.
  const turns: any[][] = [];
  let current: any[] = [];
  for (const m of nonSystem) {
    if (m.role === 'user' && current.length > 0) {
      turns.push(current);
      current = [];
    }
    current.push(m);
  }
  if (current.length > 0) turns.push(current);

  if (turns.length <= preserve) {
    // Nada que comprimir.
    return {
      messages,
      compacted: false,
      beforeTokens,
      afterTokens: beforeTokens,
      truncatedCount: 0,
      droppedCount: 0,
      method: 'skipped',
    };
  }

  const middle = turns.slice(0, turns.length - preserve).flat();
  const last = turns.slice(turns.length - preserve).flat();

  let summary: string;
  try {
    summary = await opts.llmFn(buildSummaryPrompt(middle));
  } catch (e: any) {
    return {
      messages,
      compacted: false,
      beforeTokens,
      afterTokens: beforeTokens,
      truncatedCount: 0,
      droppedCount: 0,
      method: 'skipped',
      error: 'llmFn falló: ' + (e?.message ?? String(e)),
    };
  }

  const synthetic = {
    role: 'system',
    content: `[…compactado-llm] Resumen de ${middle.length} mensajes anteriores:\n${summary}`,
  };

  const newMessages = [...systemMsgs, synthetic, ...last];
  const afterTokens = estimateTokens(newMessages);

  return {
    messages: newMessages,
    compacted: true,
    beforeTokens,
    afterTokens,
    truncatedCount: 0,
    droppedCount: middle.length,
    method: 'llm',
  };
}
