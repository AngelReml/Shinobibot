// src/refiner/level_classifier.ts
//
// Clasificador de nivel del refinador en camino caliente (FASE 1).
//
// Decide el nivel (L1/L2/L3) de una tarea con un modelo BARATO (Haiku) —
// §8 del manual, vinculante: el modelo caro NUNCA va en el paso de
// clasificación en caliente. Un solo paso. Devuelve también la confianza:
// 'low' es la señal que escala el refinado a un modelo superior.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { tryParseJSON } from '../reader/schemas.js';
import type { LLMClient } from '../reader/SubAgent.js';

const PROMPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'level_classifier_prompt.md');

export type PromptLevel = 'L1' | 'L2' | 'L3';
export type LevelConfidence = 'high' | 'medium' | 'low';

export interface LevelDecision {
  level: PromptLevel;
  confidence: LevelConfidence;
  rationale: string;
}

function stripFrontmatter(raw: string): string {
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return (m ? raw.slice(m[0].length) : raw).trim();
}

let _prompt: string | null = null;
/** Prompt madre L1 del clasificador de nivel (frontmatter de diseño descartado). */
export function levelClassifierPrompt(): string {
  if (_prompt == null) _prompt = stripFrontmatter(fs.readFileSync(PROMPT_PATH, 'utf-8'));
  return _prompt;
}

function parseDecision(raw: unknown): LevelDecision | null {
  const p = tryParseJSON(typeof raw === 'string' ? raw : JSON.stringify(raw)) as any;
  if (!p || typeof p !== 'object') return null;
  if (!(['L1', 'L2', 'L3'] as const).includes(p.level)) return null;
  const confidence: LevelConfidence =
    (['high', 'medium', 'low'] as const).includes(p.confidence) ? p.confidence : 'low';
  return {
    level: p.level as PromptLevel,
    confidence,
    rationale: typeof p.rationale === 'string' && p.rationale.trim() ? p.rationale.trim() : '(sin justificación)',
  };
}

/**
 * Clasifica el nivel de una tarea. Un solo paso, modelo barato. JSON
 * validado con reintentos resilientes a fallo transitorio del proveedor.
 * Si el modelo no produce nada válido, devuelve L2/low — el camino seguro:
 * L2 hace que el refinador SÍ revise la tarea (mejor revisar de más que
 * dejar pasar una tarea ambigua sin tocar), y 'low' fuerza la escalada.
 */
export async function classifyLevel(task: string, llm: LLMClient): Promise<LevelDecision> {
  const t = (task || '').trim();
  if (!t) return { level: 'L1', confidence: 'high', rationale: 'tarea vacía' };

  // §9 capa 1 — la tarea va en bloque <task>; no es instrucción.
  const user = `<task>\n${t}\n</task>`;
  const ask = async (extra = ''): Promise<unknown | null> => {
    try {
      return await llm.chat(
        [
          { role: 'system', content: levelClassifierPrompt() + (extra ? '\n\n' + extra : '') },
          { role: 'user', content: user },
        ],
        { temperature: 0 },
      );
    } catch {
      return null;
    }
  };

  let decision: LevelDecision | null = null;
  for (let attempt = 0; attempt < 3 && !decision; attempt++) {
    const extra = attempt === 0 ? '' : 'Your previous reply was not valid JSON. Return strictly the JSON object now.';
    const raw = await ask(extra);
    if (raw == null) { await new Promise(r => setTimeout(r, 400)); continue; }
    decision = parseDecision(raw);
  }
  if (!decision) {
    return { level: 'L2', confidence: 'low', rationale: 'no clasificable — se asume L2/low (revisar y escalar, camino seguro).' };
  }
  return decision;
}
