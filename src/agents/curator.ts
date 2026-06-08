// src/agents/curator.ts
//
// FASE 3.5 — CURATOR (síntesis de skills desde patrones observados).
//
// shinobi ya DETECTA patrones de uso repetidos (pattern_wiring) y SINTETIZA
// skills verificadas+firmadas (E2 capability_factory). El curator es el puente
// que cierra el bucle: cuando un procedimiento se repite, lo convierte en una
// skill reutilizable, VERIFICADA (E1) y FIRMADA (SHA256), en pending/.
//
// Diferencia vs el curator de Hermes (que mantiene/archiva skills por recencia):
// este CREA capacidades nuevas a partir de lo que el agente hace bien, con
// auditoría y firma — auto-mejora SEGURA.

import { synthesizeSkill, type SkillSynthesisResult } from './capability_factory.js';
import type { LLMInvoker } from './agent_loop.js';

export interface CuratePatternOptions {
  /** Secuencia de herramientas que se repitió (el patrón). */
  toolSequence: string[];
  /** Ejemplos de la(s) tarea(s) donde apareció (para guiar la síntesis). */
  examples?: string;
  /** Nº de veces observado (procedencia). */
  occurrences?: number;
  pendingDir?: string;
  invokeLLM?: LLMInvoker;
  verifyInvokeLLM?: LLMInvoker;
  now?: () => string;
}

/**
 * Convierte un patrón repetido en una skill verificada+firmada (vía E2). Devuelve
 * el resultado de la síntesis; si no pasa verificación/seguridad, NO escribe nada
 * (ok=false con el motivo).
 */
export async function curatePatternIntoSkill(opts: CuratePatternOptions): Promise<SkillSynthesisResult> {
  const seq = (opts.toolSequence ?? []).filter(Boolean);
  if (seq.length < 2) {
    return { ok: false, reason: 'structure', attempts: 0 };
  }
  const occ = opts.occurrences ?? 3;
  const goal =
    `Convierte este procedimiento repetido en una skill reutilizable.\n` +
    `Se ha observado ${occ} veces la misma secuencia de herramientas: ${seq.join(' → ')}.\n` +
    `La skill debe describir CUÁNDO aplicar este flujo (trigger_keywords) y los PASOS ` +
    `accionables, para no re-descubrirlo cada vez.`;

  return synthesizeSkill({
    goal,
    examples: opts.examples,
    pendingDir: opts.pendingDir,
    author: 'auto',
    invokeLLM: opts.invokeLLM,
    verifyInvokeLLM: opts.verifyInvokeLLM,
    now: opts.now,
  });
}
