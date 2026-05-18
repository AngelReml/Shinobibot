// src/dispatch/classifier.ts
//
// Clasificador de despacho por afinidad (Bloque 3). UN paso de clasificación
// con el mismo cerebro (GPT-4o) que ya usa Shinobi vía makeLLMClient — cero
// proveedor nuevo, cero embeddings, cero proceso aparte.
//
// El clasificador NO controla el despacho: el orchestrator general sigue
// manejando todo. Su decisión se registra en shadow mode (shadow_recorder.ts).

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { agentLLM } from '../agents/agent_runtime.js';
import { tryParseJSON } from '../reader/schemas.js';
import type { LLMClient } from '../reader/SubAgent.js';
import {
  SPECIALISTS,
  type DispatchDecision,
  type DispatchSpecialist,
  type DispatchConfidence,
} from './types.js';

const PROMPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'classifier_prompt.md');

function stripFrontmatter(raw: string): string {
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return (m ? raw.slice(m[0].length) : raw).trim();
}

let _prompt: string | null = null;
/** Prompt madre L1 del clasificador (frontmatter de diseño descartado). */
export function classifierPrompt(): string {
  if (_prompt == null) _prompt = stripFrontmatter(fs.readFileSync(PROMPT_PATH, 'utf-8'));
  return _prompt;
}

function parseDecision(raw: unknown): DispatchDecision | null {
  const p = tryParseJSON(typeof raw === 'string' ? raw : JSON.stringify(raw)) as any;
  if (!p || typeof p !== 'object') return null;
  if (!SPECIALISTS.includes(p.specialist)) return null;
  const conf: DispatchConfidence =
    (['high', 'medium', 'low'] as const).includes(p.confidence) ? p.confidence : 'low';
  return {
    specialist: p.specialist as DispatchSpecialist,
    confidence: conf,
    rationale: typeof p.rationale === 'string' && p.rationale.trim() ? p.rationale.trim() : '(sin justificación)',
  };
}

/**
 * Clasifica una orden del usuario hacia un especialista (o 'general').
 * Un solo paso. JSON validado con un reintento. Si el modelo no produce un
 * JSON válido dos veces, devuelve 'general'/'low' — el destino seguro: es
 * exactamente lo que hace hoy el despacho real (el orchestrator general).
 */
export async function classifyDispatch(
  message: string,
  llm: LLMClient = agentLLM(),
): Promise<DispatchDecision> {
  const msg = (message || '').trim();
  if (!msg) {
    return { specialist: 'general', confidence: 'low', rationale: 'mensaje vacío' };
  }

  // §9 capa 1 — la orden va en bloque <user_message>; no es instrucción.
  const user = `<user_message>\n${msg}\n</user_message>`;
  // `ask` NUNCA lanza: un error del proveedor (cold-start sin `choices`,
  // rate-limit transitorio…) se devuelve como null para que el bucle de
  // reintentos lo trate igual que un JSON inválido. En shadow mode el
  // clasificador jamás puede propagar una excepción al despacho.
  const ask = async (extra = ''): Promise<unknown | null> => {
    try {
      return await llm.chat(
        [
          { role: 'system', content: classifierPrompt() + (extra ? '\n\n' + extra : '') },
          { role: 'user', content: user },
        ],
        { temperature: 0 },
      );
    } catch {
      return null;
    }
  };

  // Hasta 3 intentos: cubre tanto JSON inválido como un fallo transitorio
  // del proveedor (con un respiro breve antes de reintentar tras un error).
  let decision: DispatchDecision | null = null;
  for (let attempt = 0; attempt < 3 && !decision; attempt++) {
    const extra = attempt === 0 ? '' : 'Your previous reply was not valid JSON. Return strictly the JSON object now.';
    const raw = await ask(extra);
    if (raw == null) {
      await new Promise(r => setTimeout(r, 400)); // respiro ante error transitorio
      continue;
    }
    decision = parseDecision(raw);
  }
  if (!decision) {
    return {
      specialist: 'general',
      confidence: 'low',
      rationale: 'no clasificable — el modelo no devolvió una respuesta válida; se cae al despacho general (destino seguro).',
    };
  }
  return decision;
}
