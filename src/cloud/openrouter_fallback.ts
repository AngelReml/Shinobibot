// src/cloud/openrouter_fallback.ts
//
// FAIL 1 (Bloque 1, validación física): cuando el OpenGravity gateway está
// caído, el orchestrator necesita un transporte alternativo para sobrevivir.
// Este módulo habla directamente con OpenRouter (compatible con la API de
// chat completions de OpenAI) y devuelve la misma envoltura `CloudResponse`
// que `OpenGravityClient.invokeLLM` para que el orchestrator no necesite
// distinguir entre los dos caminos.

import axios from 'axios';
import { CloudResponse, LLMChatPayload } from './types.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5';

export async function invokeLLMViaOpenRouter(payload: LLMChatPayload): Promise<CloudResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      output: '',
      error: 'OPENROUTER_API_KEY no está definida en .env — no se puede usar el fallback directo.',
    };
  }

  const model = payload.model || process.env.OPENROUTER_DEFAULT_MODEL || DEFAULT_MODEL;

  try {
    const response = await axios.post(
      OPENROUTER_URL,
      {
        model,
        messages: payload.messages,
        tools: payload.tools,
        tool_choice: payload.tool_choice,
        temperature: payload.temperature,
        max_tokens: payload.max_tokens,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'Shinobi (OpenGravity fallback)',
        },
        timeout: 60000,
      }
    );

    const message = response.data?.choices?.[0]?.message;
    if (!message) {
      return {
        success: false,
        output: '',
        error: `OpenRouter: respuesta vacía (data=${JSON.stringify(response.data).slice(0, 200)})`,
      };
    }
    return { success: true, output: JSON.stringify(message), error: '' };
  } catch (e: any) {
    if (e.response?.status === 401) {
      return { success: false, output: '', error: 'OpenRouter HTTP 401: OPENROUTER_API_KEY inválida.' };
    }
    const errBody = e.response?.data?.error;
    if (errBody) {
      const parts: string[] = [];
      if (errBody.message) parts.push(String(errBody.message));
      if (errBody.code) parts.push(`code=${errBody.code}`);
      if (errBody.metadata?.raw) parts.push(`raw=${JSON.stringify(errBody.metadata.raw).slice(0, 300)}`);
      else if (errBody.metadata) parts.push(`meta=${JSON.stringify(errBody.metadata).slice(0, 300)}`);
      return { success: false, output: '', error: `OpenRouter [${model}]: ${parts.join(' | ')}` };
    }
    return { success: false, output: '', error: `OpenRouter error [${model}]: ${e.message}` };
  }
}

export function isConnectionError(error: string | undefined): boolean {
  if (!error) return false;
  return /connection error|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket hang up/i.test(error);
}
