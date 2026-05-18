// src/agents/agent_runtime.ts
//
// Soporte de ejecución compartido por los agentes especialistas (Bloque 2).
// Aquí vive el cliente LLM (el mismo que usa el resto de Shinobi vía
// makeLLMClient) y los tipos de salida tangible de cada agente.

import { makeLLMClient } from '../reader/llm_adapter.js';
import type { LLMClient } from '../reader/SubAgent.js';

let _llm: LLMClient | null = null;

/** Cliente LLM compartido por los agentes — la fachada estándar de Shinobi. */
export function agentLLM(): LLMClient {
  if (!_llm) _llm = makeLLMClient();
  return _llm;
}

/** Test seam: inyecta un LLMClient (golden sets / pruebas). */
export function setAgentLLM(client: LLMClient | null): void {
  _llm = client;
}

// ─── Salida tangible de DocsAgent ───────────────────────────────────────────
export interface DocsOutput {
  /** Ruta del fichero de documento generado. */
  artifact: string;
  /** Tamaño del fichero en bytes. */
  bytes: number;
  /** Formato producido. */
  format: 'pdf' | 'markdown' | 'word';
  /** Resumen de la estructura (encabezados producidos). */
  structure: string;
  /** Contenido faltante/no usable, o null si no hubo huecos. */
  gaps: string | null;
}

// ─── Salida tangible de DataAgent ───────────────────────────────────────────
export interface DataOutput {
  /** Ruta del fichero de gráfico (.svg) generado. */
  artifact: string;
  bytes: number;
  /** Tipo de gráfico elegido. */
  chartType: string;
  /** Una frase: por qué ese tipo encaja con los datos. */
  rationale: string;
  gaps: string | null;
}

// ─── Salida de ResearchAgent ────────────────────────────────────────────────
export interface ResearchSource {
  title: string;
  url: string;
}
export interface ResearchOutput {
  /**
   * False si la investigación no tiene NINGUNA fuente verificable — §10 del
   * manual: sin fuente, el output es inválido.
   */
  valid: boolean;
  /** Respuesta directa a la pregunta. */
  answer: string;
  /** Hallazgos, cada uno respaldado por una fuente. */
  findings: string[];
  /** Fuentes verificables citadas (extraídas de los resultados de búsqueda). */
  sources: ResearchSource[];
  /** Qué no se pudo verificar. */
  confidence: string;
}

/** Un resultado de búsqueda web — lo que devuelve un `searchFn`. */
export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * `searchFn` de ResearchAgent. En producción envuelve la tool `web_search`;
 * en el golden set se inyecta con fixtures de resultados web reales
 * capturados (test seam, igual que `BackgroundReviewOptions.invoker`).
 */
export type SearchFn = (query: string) => Promise<WebResult[]>;
