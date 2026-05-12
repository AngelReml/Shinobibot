// src/providers/openai_client.ts
//
// Bloque 7 — OpenAI native client. Default gpt-4o-mini (cheap, capable).

import axios from 'axios';
import type { CloudResponse, LLMChatPayload } from '../cloud/types.js';
import type { KeyValidation, ProviderClient } from './types.js';

const BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

export const openaiClient: ProviderClient = {
  name: 'openai',
  defaultModel: () => DEFAULT_MODEL,
  signupUrl: () => 'https://platform.openai.com/api-keys',
  label: () => 'OpenAI (GPT-4)',

  async invokeLLM(payload: LLMChatPayload): Promise<CloudResponse> {
    const key = process.env.SHINOBI_PROVIDER_KEY;
    if (!key) return { success: false, output: '', error: 'OpenAI: SHINOBI_PROVIDER_KEY no está definida.' };
    const model = payload.model || process.env.SHINOBI_MODEL_DEFAULT || DEFAULT_MODEL;
    try {
      const resp = await axios.post(`${BASE_URL}/chat/completions`, {
        model,
        messages: payload.messages,
        tools: payload.tools,
        tool_choice: payload.tool_choice,
        temperature: payload.temperature,
        max_tokens: payload.max_tokens,
      }, {
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        timeout: 60000,
      });
      const msg = resp.data?.choices?.[0]?.message;
      if (!msg) return { success: false, output: '', error: `OpenAI: respuesta vacía (data=${JSON.stringify(resp.data).slice(0, 200)})` };
      return { success: true, output: JSON.stringify(msg), error: '' };
    } catch (e: any) {
      if (e.response?.status === 401) return { success: false, output: '', error: 'OpenAI HTTP 401: key inválida.' };
      if (e.response?.data?.error?.message) return { success: false, output: '', error: `OpenAI: ${e.response.data.error.message}` };
      return { success: false, output: '', error: `OpenAI error [${model}]: ${e.message}` };
    }
  },

  async validateKey(key: string): Promise<KeyValidation> {
    if (!key || !key.trim()) return { ok: false, error: 'La key está vacía.' };
    try {
      const resp = await axios.get(`${BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${key.trim()}` },
        timeout: 10000,
      });
      if (resp.status === 200) return { ok: true, status: 200 };
      return { ok: false, error: `OpenAI respondió status ${resp.status}.`, status: resp.status };
    } catch (e: any) {
      const status = e.response?.status;
      if (status === 401) return { ok: false, status: 401, error: 'Esta key no es válida (OpenAI devolvió 401). Verifica que la copiaste completa desde https://platform.openai.com/api-keys' };
      if (status === 429) return { ok: false, status: 429, error: 'OpenAI rate-limit. Espera unos segundos y vuelve a intentar.' };
      return { ok: false, error: `OpenAI error: ${e.message}` };
    }
  },
};
