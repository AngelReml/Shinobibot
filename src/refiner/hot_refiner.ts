// src/refiner/hot_refiner.ts
//
// Refinador de prompts en camino caliente (FASE 1) con CASCADA ECONÓMICA.
//
// Se interpone entre el despacho y el subordinado: toda tarea que iría a un
// SpecialistAgent pasa antes por aquí. Decide el nivel (L1/L2/L3) y solo
// reescribe la tarea si el nivel lo exige:
//   - L1 → pasa intacta (no se reescribe).
//   - L2/L3 → se refina reutilizando la lógica YA VALIDADA de
//     src/skills/prompt_refactor/ (no se reimplementa el refactor).
//
// CASCADA ECONÓMICA (§8 del manual, vinculante):
//   - El nivel lo decide SIEMPRE un modelo barato (Haiku) en caliente.
//   - El refinado lo hace ese mismo modelo barato salvo que la clasificación
//     marque la tarea como ambigua (confidence='low') — único umbral de
//     escalada — en cuyo caso se escala a un modelo superior (Sonnet).
//   - Opus / GPT-4o NUNCA entran en el camino caliente. Esto corrige el
//     defecto del prototipo refactor.py (que ponía Opus en caliente).

import { makeLLMClient } from '../reader/llm_adapter.js';
import type { LLMClient } from '../reader/SubAgent.js';
import { refineConcreteTask } from '../skills/prompt_refactor/refactor.js';
import { classifyLevel, type PromptLevel, type LevelConfidence } from './level_classifier.js';

/** Modelo barato del camino caliente — clasificación y refinado por defecto. */
export const HOT_MODEL = 'claude-haiku-4-5';
/** Modelo superior — SOLO para el refinado de tareas marcadas ambiguas. */
export const ESCALATION_MODEL = 'claude-sonnet-4-6';

export interface RefineResult {
  level: PromptLevel;
  confidence: LevelConfidence;
  levelRationale: string;
  /** Tarea original recibida. */
  originalTask: string;
  /** Tarea tras el refinador (= original si no se reescribió). */
  refinedTask: string;
  /** True si la tarea se reescribió (solo ocurre en L2/L3). */
  rewritten: boolean;
  /** Modelo lógico usado (Haiku en el caso normal, Sonnet si escaló). */
  modelUsed: string;
  /** True si se escaló al modelo superior por ambigüedad. */
  escalated: boolean;
}

// Clientes LLM fijados a un modelo concreto (cacheados). `refactorPrompt`
// llama a `llm.chat()` sin pasar `model`; estos wrappers lo fuerzan.
const _pinned = new Map<string, LLMClient>();
function pinnedClient(model: string): LLMClient {
  let c = _pinned.get(model);
  if (!c) {
    const base = makeLLMClient();
    c = { chat: (messages, opts) => base.chat(messages, { ...opts, model }) };
    _pinned.set(model, c);
  }
  return c;
}

/**
 * Refina una tarea antes de mandarla a un especialista. Cascada económica.
 * NUNCA lanza: un fallo del refinado degrada a "pasar la tarea intacta"
 * (rewritten=false) — coherente con el modo shadow.
 */
export async function refineTask(task: string): Promise<RefineResult> {
  const t = (task || '').trim();
  if (!t) {
    return {
      level: 'L1', confidence: 'high', levelRationale: 'tarea vacía',
      originalTask: t, refinedTask: t, rewritten: false, modelUsed: HOT_MODEL, escalated: false,
    };
  }

  // Paso 1 — clasificación de nivel con el modelo BARATO (camino caliente).
  const cls = await classifyLevel(t, pinnedClient(HOT_MODEL));

  // L1 → la tarea pasa intacta; no se reescribe (§6: L1 no necesita refinado).
  if (cls.level === 'L1') {
    return {
      level: 'L1', confidence: cls.confidence, levelRationale: cls.rationale,
      originalTask: t, refinedTask: t, rewritten: false, modelUsed: HOT_MODEL, escalated: false,
    };
  }

  // L2/L3 → refinar. Se escala SOLO si la clasificación marcó ambigüedad.
  const escalated = cls.confidence === 'low';
  const model = escalated ? ESCALATION_MODEL : HOT_MODEL;

  let refinedTask = t;
  let rewritten = false;
  try {
    // refineConcreteTask: reutiliza la lógica validada de prompt_refactor
    // pero entrega una tarea CONCRETA (sin templatizar) — el subordinado
    // recibe una tarea ejecutable, no una plantilla con placeholders.
    const r = await refineConcreteTask(t, pinnedClient(model));
    if (r.refinedTask && r.refinedTask.trim()) {
      refinedTask = r.refinedTask.trim();
      rewritten = refinedTask !== t;
    }
  } catch {
    // El refinado falló → la tarea pasa intacta (degradación segura).
    refinedTask = t;
    rewritten = false;
  }

  return {
    level: cls.level, confidence: cls.confidence, levelRationale: cls.rationale,
    originalTask: t, refinedTask, rewritten, modelUsed: model, escalated,
  };
}
