// src/providers/anthropic_client.ts
//
// Bloque 7 — Anthropic native client. Default claude-haiku-4-5.
//
// Anthropic NO usa el shape OpenAI: pide `messages` con `system` separado y
// devuelve `content` como array de blocks (`{type:'text', text:...}` o
// `{type:'tool_use', ...}`). Convertimos al envelope OpenAI-compatible que
// el orchestrator espera.

import axios from 'axios';
import type { CloudResponse, LLMChatPayload } from '../cloud/types.js';
import type { KeyValidation, ProviderClient } from './types.js';

const BASE_URL = 'https://api.anthropic.com/v1';
const DEFAULT_MODEL = 'claude-haiku-4-5';
const API_VERSION = '2023-06-01';

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
  for (const m of messages) {
    if (m.role === 'system') {
      const txt = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      if (txt) systemParts.push(txt);
    } else {
      rest.push(m);
    }
  }
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
    const key = process.env.SHINOBI_PROVIDER_KEY;
    if (!key) return { success: false, output: '', error: 'Anthropic: SHINOBI_PROVIDER_KEY no está definida.' };
    const model = payload.model || process.env.SHINOBI_MODEL_DEFAULT || DEFAULT_MODEL;
    const { system, rest } = splitSystemAndMessages(payload.messages);

    // Anthropic requiere max_tokens explícito.
    const max_tokens = payload.max_tokens ?? 2048;

    // Conversión de tools OpenAI → Anthropic.
    let tools: any[] | undefined;
    if (Array.isArray(payload.tools) && payload.tools.length > 0) {
      tools = payload.tools.map((t: any) => ({
        name: t.function?.name ?? t.name,
        description: t.function?.description ?? t.description,
        input_schema: t.function?.parameters ?? t.parameters ?? { type: 'object', properties: {} },
      }));
    }

    try {
      const resp = await axios.post(`${BASE_URL}/messages`, {
        model,
        system: system || undefined,
        messages: rest,
        max_tokens,
        temperature: payload.temperature,
        tools,
      }, {
        headers: {
          'x-api-key': key,
          'anthropic-version': API_VERSION,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      });

      const blocks: AnthropicContentBlock[] = resp.data?.content || [];
      const content = flattenAnthropicContent(blocks);
      const tool_calls = extractToolCalls(blocks);
      const openAiMsg: any = { role: 'assistant', content };
      if (tool_calls) openAiMsg.tool_calls = tool_calls;
      return { success: true, output: JSON.stringify(openAiMsg), error: '' };
    } catch (e: any) {
      if (e.response?.status === 401) return { success: false, output: '', error: 'Anthropic HTTP 401: key inválida.' };
      if (e.response?.data?.error?.message) return { success: false, output: '', error: `Anthropic: ${e.response.data.error.message}` };
      return { success: false, output: '', error: `Anthropic error [${model}]: ${e.message}` };
    }
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
