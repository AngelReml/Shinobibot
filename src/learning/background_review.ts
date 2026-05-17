/**
 * Fase 1 del bucle de aprendizaje — Background Review (Motor 1).
 *
 * Tras una misión, si saltó un nudge, una revisión LLM acotada decide qué
 * guardar en memoria y qué capturar como skill. Equivale al fork de Hermes
 * (`background_review.py`), pero en vez de un bucle de tools usa una
 * decisión estructurada: el LLM auxiliar barato devuelve JSON y este módulo
 * lo despacha por las rutas YA auditadas de Shinobi —
 * `curatedMemory().appendEnv()` (escanea inyección) y
 * `skillManager().proposeSkill()` (genera SKILL.md + audita + firma).
 *
 * Best-effort: nunca lanza, nunca bloquea la respuesta al usuario.
 */

import { invokeLLMViaOpenRouter } from '../cloud/openrouter_fallback.js';
import type { CloudResponse, LLMChatPayload } from '../cloud/types.js';
import { curatedMemory } from '../memory/curated_memory.js';
import { skillManager } from '../skills/skill_manager.js';
import { buildReviewPrompt } from './review_prompts.js';

export type ReviewInvoker = (payload: LLMChatPayload) => Promise<CloudResponse>;

export interface ConversationMessage {
  role: string;
  content: string;
}

export interface BackgroundReviewOptions {
  history: ConversationMessage[];
  reviewMemory: boolean;
  reviewSkills: boolean;
  /** Inyectable para tests (evita la llamada de red real). */
  invoker?: ReviewInvoker;
}

export interface BackgroundReviewResult {
  ok: boolean;
  memorySaved: number;
  skillsProposed: number;
  note: string;
  error?: string;
}

/** Modelo auxiliar barato — el review corre seguido, no usa el principal. */
function reviewModel(): string {
  return process.env.SHINOBI_REVIEW_MODEL || 'anthropic/claude-haiku-4.5';
}

/** ¿Está el Motor 1 habilitado? Opt-in, como el resto de subsistemas. */
export function backgroundReviewEnabled(): boolean {
  return process.env.SHINOBI_REVIEW_ENABLED === '1';
}

let _running = false;
/** Evita dos reviews solapados (y que el review se dispare a sí mismo). */
export function reviewInProgress(): boolean { return _running; }

/** Construye el transcript que ve el review (últimos N turnos). */
function buildTranscript(history: ConversationMessage[], maxMessages = 24): string {
  const recent = history.slice(-maxMessages);
  return recent
    .filter((m) => m.role !== 'system' && typeof m.content === 'string' && m.content.trim())
    .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 2000)}`)
    .join('\n\n');
}

/** Extrae el JSON de decisión de la respuesta del LLM (tolerante a fences). */
function parseDecision(raw: string): { memory: Array<{ content: string }>; skills: Array<{ context: string }>; note: string } {
  let text = raw.trim();
  // El LLM puede envolver en ```json ... ``` pese a la instrucción.
  text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  // Si hay prosa alrededor, recorta al primer { … último }.
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first > 0 || last < text.length - 1) {
    if (first >= 0 && last > first) text = text.slice(first, last + 1);
  }
  const parsed = JSON.parse(text);
  const memory = Array.isArray(parsed.memory)
    ? parsed.memory.filter((e: any) => e && typeof e.content === 'string' && e.content.trim())
    : [];
  const skills = Array.isArray(parsed.skills)
    ? parsed.skills.filter((e: any) => e && typeof e.context === 'string' && e.context.trim())
    : [];
  return { memory, skills, note: typeof parsed.note === 'string' ? parsed.note : '' };
}

/**
 * Ejecuta una revisión post-misión. Devuelve un resumen; nunca lanza.
 * El caller la invoca fire-and-forget desde el `finally` de `process()`.
 */
export async function runBackgroundReview(opts: BackgroundReviewOptions): Promise<BackgroundReviewResult> {
  const empty: BackgroundReviewResult = { ok: false, memorySaved: 0, skillsProposed: 0, note: '' };
  if (_running) return { ...empty, note: 'review ya en curso' };
  if (!opts.reviewMemory && !opts.reviewSkills) return { ...empty, ok: true, note: 'sin nudge' };

  _running = true;
  try {
    const transcript = buildTranscript(opts.history);
    if (!transcript) return { ...empty, ok: true, note: 'transcript vacío' };

    const prompt = `CONVERSATION TRANSCRIPT:\n\n${transcript}\n\n---\n\n${buildReviewPrompt(opts.reviewMemory, opts.reviewSkills)}`;
    const invoke = opts.invoker ?? invokeLLMViaOpenRouter;
    const res = await invoke({
      model: reviewModel(),
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 1500,
    });
    if (!res.success) return { ...empty, error: `LLM: ${res.error}`, note: 'review LLM falló' };

    // res.output es un JSON string {content}; content es la decisión JSON.
    let decisionText = '';
    try {
      const msg = JSON.parse(res.output);
      decisionText = typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content) ? msg.content.map((p: any) => p.text || '').join('') : '';
    } catch {
      decisionText = res.output; // algunos invokers ya devuelven texto plano
    }
    let decision;
    try { decision = parseDecision(decisionText); }
    catch (e: any) { return { ...empty, error: `parse: ${e?.message ?? e}`, note: 'decisión no parseable' }; }

    // Despacho — memoria: por la ruta auditada de CuratedMemory (escanea
    // inyección antes de aceptar).
    let memorySaved = 0;
    if (opts.reviewMemory) {
      for (const entry of decision.memory) {
        try {
          const r = curatedMemory().appendEnv(entry.content.trim());
          if (r.ok) memorySaved++;
        } catch (e: any) { console.log(`[review] appendEnv falló: ${e?.message ?? e}`); }
      }
    }

    // Despacho — skills: proposeSkill genera el SKILL.md, lo audita y lo
    // deja en skills/pending/ para confirmación humana. kind='review'.
    let skillsProposed = 0;
    if (opts.reviewSkills) {
      for (const entry of decision.skills) {
        try {
          const r = await skillManager().proposeSkill(entry.context.trim(), 'review');
          if (r.ok) skillsProposed++;
        } catch (e: any) { console.log(`[review] proposeSkill falló: ${e?.message ?? e}`); }
      }
    }

    const note = decision.note || (memorySaved + skillsProposed === 0 ? 'nada que guardar' : 'ok');
    if (memorySaved + skillsProposed > 0) {
      console.log(`💾 Self-improvement review: ${memorySaved} memoria · ${skillsProposed} skill(s) propuesta(s)`);
    }
    return { ok: true, memorySaved, skillsProposed, note };
  } catch (e: any) {
    return { ...empty, error: e?.message ?? String(e), note: 'review falló' };
  } finally {
    _running = false;
  }
}
