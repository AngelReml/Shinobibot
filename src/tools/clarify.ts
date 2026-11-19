/**
 * clarify — preguntar al usuario cuando de verdad hace falta (mejora tomada
 * de Hermes Agent).
 *
 * Sin esta tool el agente solo tiene dos salidas ante una duda que decide el
 * resultado: adivinar o seguir gastando turnos. `clarify` deja la pregunta
 * anotada; el orquestador, al terminar de ejecutar las tools de ese paso,
 * CIERRA el turno y se la enseña al usuario (ver orchestrator.ts). La
 * respuesta llega como el siguiente mensaje del usuario, con el historial
 * intacto.
 *
 * Los subagentes no tienen a quién preguntar: para ellos la tool devuelve un
 * error que les dice que decidan y lo declaren.
 */
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { getSpawnDepth } from '../agents/spawn_depth.js';

export const CLARIFY_MAX_CHOICES = 4;
export const CLARIFY_MAX_QUESTION = 600;

export interface PendingClarify { question: string; choices: string[] }

let _pending: PendingClarify | null = null;

/** Lee y vacía la pregunta pendiente. La consume el orquestador. */
export function takePendingClarify(): PendingClarify | null {
  const p = _pending;
  _pending = null;
  return p;
}

/** Texto que ve el usuario. */
export function formatClarify(p: PendingClarify): string {
  if (p.choices.length === 0) return p.question;
  const opts = p.choices.map((c, i) => `  ${i + 1}. ${c}`).join('\n');
  return `${p.question}\n${opts}\n(Responde con el número o con tus propias palabras.)`;
}

export function parseClarifyArgs(args: any): PendingClarify | string {
  const question = String(args?.question ?? '').trim();
  if (!question) return 'falta "question"';
  const rawChoices = args?.choices;
  if (rawChoices !== undefined && rawChoices !== null && !Array.isArray(rawChoices)) return '"choices" debe ser una lista';
  const choices = (Array.isArray(rawChoices) ? rawChoices : [])
    .map((c: any) => String(c ?? '').trim())
    .filter((c: string) => c.length > 0)
    .map((c: string) => c.slice(0, 200));
  if (choices.length > CLARIFY_MAX_CHOICES) return `máximo ${CLARIFY_MAX_CHOICES} opciones`;
  return { question: question.slice(0, CLARIFY_MAX_QUESTION), choices };
}

const tool: Tool = {
  name: 'clarify',
  description:
    'Ask the user ONE question and stop until they answer. Use it only when the answer changes what you do and you cannot find it out yourself with your tools ' +
    '(a missing fact only the user knows, or an irreversible choice that could reasonably go either way). Never use it for things you can read, search or test. ' +
    `Optionally pass up to ${CLARIFY_MAX_CHOICES} short choices. The turn ends after this call; the user's reply arrives as the next message.`,
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question, in the user\'s language, self-contained.' },
      choices: { type: 'array', items: { type: 'string' }, description: `Optional, up to ${CLARIFY_MAX_CHOICES} short options.` },
    },
    required: ['question'],
  },
  categories: ['planning'],

  async execute(args: any): Promise<ToolResult> {
    if (getSpawnDepth() > 0) {
      return { success: false, output: '', error: 'No hay usuario al que preguntar en un subagente: toma la decisión más razonable y declárala en tu respuesta.' };
    }
    const p = parseClarifyArgs(args);
    if (typeof p === 'string') return { success: false, output: '', error: p };
    _pending = p;
    return { success: true, output: 'Pregunta registrada. El turno se cierra y el usuario la verá ahora; no sigas trabajando hasta su respuesta.' };
  },
};

registerTool(tool);
export default tool;
