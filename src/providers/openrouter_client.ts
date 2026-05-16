// src/providers/openrouter_client.ts
//
// Bloque 7 — OpenRouter native client. OpenAI-compatible; cubre todos los
// providers que OpenRouter ofrece. Reusa la lógica de Bloque 1.1 con
// envoltura uniforme.

import axios from 'axios';
import type { CloudResponse, LLMChatPayload } from '../cloud/types.js';
import type { KeyValidation, ProviderClient } from './types.js';

const BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5';

export const openrouterClient: ProviderClient = {
  name: 'openrouter',
  defaultModel: () => DEFAULT_MODEL,
  signupUrl: () => 'https://openrouter.ai/keys',
  label: () => 'OpenRouter (todos)',

  async invokeLLM(payload: LLMChatPayload): Promise<CloudResponse> {
    // Key específica primero, fallback a la genérica (failover cross-provider).
    const key = process.env.OPENROUTER_API_KEY || process.env.SHINOBI_PROVIDER_KEY;
    if (!key) return { success: false, output: '', error: 'OpenRouter: define OPENROUTER_API_KEY (o SHINOBI_PROVIDER_KEY).' };
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
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'X-Title': 'Shinobi',
        },
        timeout: 60000,
      });
      const msg = resp.data?.choices?.[0]?.message;
      if (!msg) return { success: false, output: '', error: `OpenRouter: respuesta vacía (data=${JSON.stringify(resp.data).slice(0, 200)})` };
      return { success: true, output: JSON.stringify(msg), error: '' };
    } catch (e: any) {
      if (e.response?.status === 401) return { success: false, output: '', error: 'OpenRouter HTTP 401: key inválida.' };
      if (e.response?.data?.error?.message) return { success: false, output: '', error: `OpenRouter: ${e.response.data.error.message}` };
      return { success: false, output: '', error: `OpenRouter error [${model}]: ${e.message}` };
    }
  },

  async validateKey(key: string): Promise<KeyValidation> {
    if (!key || !key.trim()) return { ok: false, error: 'La key está vacía.' };
    try {
      const resp = await axios.get(`${BASE_URL}/auth/key`, {
        headers: { Authorization: `Bearer ${key.trim()}` },
        timeout: 10000,
      });
      if (resp.status === 200) return { ok: true, status: 200 };
      return { ok: false, error: `OpenRouter respondió status ${resp.status}.`, status: resp.status };
    } catch (e: any) {
      const status = e.response?.status;
      if (status === 401) return { ok: false, status: 401, error: 'Esta key no es válida (OpenRouter devolvió 401). Verifica que la copiaste completa desde https://openrouter.ai/keys' };
      if (status === 429) return { ok: false, status: 429, error: 'OpenRouter rate-limit. Espera unos segundos y vuelve a intentar.' };
      return { ok: false, error: `OpenRouter error: ${e.message}` };
    }
  },
};
