// src/providers/anthropic_client.ts
//
// Bloque 7 — Anthropic native client. Default claude-haiku-4-5.
//
// Caché de prompt (2026-11): la conversación se reenvía entera en cada paso
// del bucle. Marcamos con `cache_control` lo que no cambia (tools, system y la
// cola de la conversación) para que Anthropic lo cobre como lectura de caché.
// ON por defecto; se apaga con SHINOBI_ANTHROPIC_CACHE=0.
//
// Pool de claves: ANTHROPIC_API_KEYS (CSV) además de ANTHROPIC_API_KEY. Ante
// 401/403/429 se prueba la siguiente clave; la que funciona se queda "pegada"
// para las llamadas siguientes (cambiar de clave pierde la caché).
//
// Anthropic NO usa el shape OpenAI: pide `messages` con `system` separado y
// devuelve `content` como array de blocks (`{type:'text', text:...}` o
// `{type:'tool_use', ...}`). Convertimos al envelope OpenAI-compatible que
// el orchestrator espera.

import axios from 'axios';
import type { CloudResponse, LLMChatPayload } from '../cloud/types.js';
import type { KeyValidation, ProviderClient } from './types.js';
import { normalizeModelId } from './model_id.js';

const BASE_URL = 'https://api.anthropic.com/v1';
const DEFAULT_MODEL = 'claude-haiku-4-5';
const API_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_TIMEOUT_MS = 180000;
const CACHE_MARK = { type: 'ephemeral' } as const;

/** ¿Caché de prompt activa? ON salvo SHINOBI_ANTHROPIC_CACHE=0|false|off. */
export function cachingEnabled(): boolean {
  const v = (process.env.SHINOBI_ANTHROPIC_CACHE ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off');
}

/** Devuelve una COPIA del mensaje con el punto de caché en su último bloque, o null si no se puede marcar. */
function markMessage(m: any): any | null {
  if (typeof m?.content === 'string') {
    if (!m.content.trim()) return null; // Anthropic rechaza bloques de texto vacíos
    return { ...m, content: [{ type: 'text', text: m.content, cache_control: CACHE_MARK }] };
  }
  if (Array.isArray(m?.content) && m.content.length > 0) {
    const blocks = m.content.slice();
    const last = blocks[blocks.length - 1];
    if (!last || typeof last !== 'object') return null;
    if (last.type === 'text' && !String(last.text ?? '').trim()) return null;
    blocks[blocks.length - 1] = { ...last, cache_control: CACHE_MARK };
    return { ...m, content: blocks };
  }
  return null;
}

/**
 * Coloca los puntos de caché (máx. 4 por petición, límite de Anthropic):
 * última tool, system y los dos últimos mensajes marcables. No muta la entrada.
 */
export function applyPromptCaching(
  system: string,
  tools: any[] | undefined,
  messages: any[],
): { system: any; tools: any[] | undefined; messages: any[] } {
  const sys = system ? [{ type: 'text', text: system, cache_control: CACHE_MARK }] : undefined;
  let outTools = tools;
  if (Array.isArray(tools) && tools.length > 0) {
    outTools = tools.slice();
    outTools[outTools.length - 1] = { ...outTools[outTools.length - 1], cache_control: CACHE_MARK };
  }
  const out = messages.slice();
  let marked = 0;
  for (let i = out.length - 1; i >= 0 && marked < 2; i--) {
    const mm = markMessage(out[i]);
    if (mm) { out[i] = mm; marked++; }
  }
  return { system: sys, tools: outTools, messages: out };
}

/** Claves disponibles, sin duplicados: ANTHROPIC_API_KEY, luego ANTHROPIC_API_KEYS (CSV); si no hay ninguna, SHINOBI_PROVIDER_KEY. */
export function anthropicKeys(): string[] {
  const out: string[] = [];
  const single = (process.env.ANTHROPIC_API_KEY || '').trim();
  const pool = (process.env.ANTHROPIC_API_KEYS || '').split(',').map((k) => k.trim()).filter(Boolean);
  for (const k of [single, ...pool]) if (k && !out.includes(k)) out.push(k);
  if (out.length === 0) {
    const generic = (process.env.SHINOBI_PROVIDER_KEY || '').trim();
    if (generic) out.push(generic);
  }
  return out;
}

let _stickyKey = 0;
/** Solo tests: olvida qué clave del pool funcionó la última vez. */
export function _resetKeyPoolForTests(): void { _stickyKey = 0; }

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: any;
}

function splitSystemAndMessages(messages: any[]): { system: string; rest: any[] } {
  const systemParts: string[] = [];
  const rest: any[] = [];
  let pendingToolResults: any[] = [];

  const flushToolResults = () => {
    if (pendingToolResults.length > 0) {
      rest.push({ role: 'user', content: pendingToolResults });
      pendingToolResults = [];
    }
  };

  for (const m of messages) {
    if (m.role === 'system') {
      const txt = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      if (txt) systemParts.push(txt);
    } else if (m.role === 'tool') {
      pendingToolResults.push({
        type: 'tool_result',
        tool_use_id: m.tool_call_id,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      });
    } else if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      // FIX (2026-06-10): un assistant con tool_calls en formato OpenAI rompía
      // Anthropic ("messages.X.tool_calls: Extra inputs are not permitted").
      // Se traduce a bloques de contenido nativos: texto + tool_use.
      flushToolResults();
      const blocks: any[] = [];
      const text = typeof m.content === 'string' ? m.content : '';
      if (text.trim()) blocks.push({ type: 'text', text });
      for (const tc of m.tool_calls) {
        let input: any = {};
        try {
          const raw = tc.function?.arguments;
          input = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw ?? {});
        } catch { input = {}; }
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.function?.name, input });
      }
      rest.push({ role: 'assistant', content: blocks });
    } else {
      // Mensaje normal (user/assistant texto). Solo role+content; nada de
      // campos OpenAI-only (refusal, annotations, name, tool_call_id…).
      flushToolResults();
      const content = typeof m.content === 'string' ? m.content : (m.content ?? '');
      rest.push({ role: m.role, content });
    }
  }
  flushToolResults();
  return { system: systemParts.join('\n\n'), rest };
}

function flattenAnthropicContent(blocks: AnthropicContentBlock[] | undefined): string {
  if (!Array.isArray(blocks)) return '';
  const texts: string[] = [];
  for (const b of blocks) {
    if (b.type === 'text' && b.text) texts.push(b.text);
  }
  return texts.join('\n');
}

function extractToolCalls(blocks: AnthropicContentBlock[] | undefined): any[] | undefined {
  if (!Array.isArray(blocks)) return undefined;
  const calls = blocks
    .filter(b => b.type === 'tool_use')
    .map(b => ({
      id: b.id,
      type: 'function',
      function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
    }));
  return calls.length > 0 ? calls : undefined;
}

export const anthropicClient: ProviderClient = {
  name: 'anthropic',
  defaultModel: () => DEFAULT_MODEL,
  signupUrl: () => 'https://console.anthropic.com/settings/keys',
  label: () => 'Anthropic (Claude)',

  async invokeLLM(payload: LLMChatPayload): Promise<CloudResponse> {
    // Key específica primero, fallback a la genérica (failover cross-provider).
    const keys = anthropicKeys();
    if (keys.length === 0) return { success: false, output: '', error: 'Anthropic: define ANTHROPIC_API_KEY (o SHINOBI_PROVIDER_KEY).' };
    const model = normalizeModelId(payload.model || process.env.SHINOBI_MODEL_DEFAULT, 'anthropic', DEFAULT_MODEL);
    const { system, rest } = splitSystemAndMessages(payload.messages);

    // Anthropic requiere max_tokens explícito. Configurable vía SHINOBI_ANTHROPIC_MAX_TOKENS.
    const max_tokens = payload.max_tokens ?? (Number(process.env.SHINOBI_ANTHROPIC_MAX_TOKENS) || DEFAULT_MAX_TOKENS);

    // Conversión de tools OpenAI → Anthropic.
    let tools: any[] | undefined;
    if (Array.isArray(payload.tools) && payload.tools.length > 0) {
      tools = payload.tools.map((t: any) => ({
        name: t.function?.name ?? t.name,
        description: t.function?.description ?? t.description,
        input_schema: t.function?.parameters ?? t.parameters ?? { type: 'object', properties: {} },
      }));
    }

    const body = cachingEnabled()
      ? applyPromptCaching(system, tools, rest)
      : { system: system || undefined, tools, messages: rest };

    // Pool de claves: se empieza por la última que funcionó; 401/403/429 → siguiente.
    let lastError: CloudResponse = { success: false, output: '', error: 'Anthropic: sin claves que probar.' };
    for (let attempt = 0; attempt < keys.length; attempt++) {
      const idx = (_stickyKey + attempt) % keys.length;
      try {
        const resp = await axios.post(`${BASE_URL}/messages`, {
          model,
          system: body.system,
          messages: body.messages,
          max_tokens,
          temperature: payload.temperature,
          tools: body.tools,
        }, {
          headers: {
            'x-api-key': keys[idx],
            'anthropic-version': API_VERSION,
            'Content-Type': 'application/json',
          },
          timeout: Number(process.env.SHINOBI_LLM_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
        });
        _stickyKey = idx;

        const blocks: AnthropicContentBlock[] = resp.data?.content || [];
        const content = flattenAnthropicContent(blocks);
        const tool_calls = extractToolCalls(blocks);
        const openAiMsg: any = { role: 'assistant', content };
        if (tool_calls) openAiMsg.tool_calls = tool_calls;
        const u = resp.data?.usage;
        // Anthropic NO incluye lo cacheado en input_tokens: el prompt real es la suma de los tres.
        const cacheRead = u?.cache_read_input_tokens || 0;
        const cacheWrite = u?.cache_creation_input_tokens || 0;
        const promptTokens = (u?.input_tokens || 0) + cacheRead + cacheWrite;
        const usage = u ? {
          prompt_tokens: promptTokens,
          completion_tokens: u.output_tokens || 0,
          total_tokens: promptTokens + (u.output_tokens || 0),
          cache_read_tokens: cacheRead,
          cache_write_tokens: cacheWrite,
        } : undefined;
        return { success: true, output: JSON.stringify(openAiMsg), error: '', usage };
      } catch (e: any) {
        const status = e.response?.status;
        if (status === 401) lastError = { success: false, output: '', error: 'Anthropic HTTP 401: key inválida.' };
        else if (e.response?.data?.error?.message) lastError = { success: false, output: '', error: `Anthropic: ${e.response.data.error.message}` };
        else lastError = { success: false, output: '', error: `Anthropic error [${model}]: ${e.message}` };
        const rotable = status === 401 || status === 403 || status === 429;
        if (!rotable) return lastError;
        if (attempt < keys.length - 1) console.log(`[Shinobi] Anthropic: clave ${idx + 1}/${keys.length} respondió ${status}; pruebo la siguiente.`);
      }
    }
    return lastError;
  },

  async validateKey(key: string): Promise<KeyValidation> {
    if (!key || !key.trim()) return { ok: false, error: 'La key está vacía.' };
    try {
      const resp = await axios.get(`${BASE_URL}/models`, {
        headers: {
          'x-api-key': key.trim(),
          'anthropic-version': API_VERSION,
        },
        timeout: 10000,
      });
      if (resp.status === 200) return { ok: true, status: 200 };
      return { ok: false, error: `Anthropic respondió status ${resp.status}.`, status: resp.status };
    } catch (e: any) {
      const status = e.response?.status;
      if (status === 401) return { ok: false, status: 401, error: 'Esta key no es válida (Anthropic devolvió 401). Verifica que la copiaste completa desde https://console.anthropic.com/settings/keys' };
      if (status === 429) return { ok: false, status: 429, error: 'Anthropic rate-limit. Espera unos segundos y vuelve a intentar.' };
      return { ok: false, error: `Anthropic error: ${e.message}` };
    }
  },
};
