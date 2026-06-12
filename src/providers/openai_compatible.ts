// src/providers/openai_compatible.ts
//
// Bloque 7.2 — fábrica de clientes OpenAI-compatibles (absorbido de
// swarm-ide/smart_router.py::ModelEntry.build). La mayoría de proveedores
// hablan el mismo dialecto que OpenAI (`POST {baseUrl}/chat/completions`):
// Groq, OpenRouter, GLM, Gemini (vía su endpoint OpenAI), DeepSeek,
// HuggingFace router, y CUALQUIER modelo local (Ollama, LM Studio, llama.cpp,
// vLLM) por su `baseUrl`. En vez de un fichero-cliente por proveedor, los
// declaramos como DATOS y esta fábrica produce el ProviderClient.
//
// Reutiliza los arreglos del Bloque 7.1: normaliza el model-ID por proveedor
// (`normalizeModelId`) y sanea los mensajes (`sanitizeOpenAiMessages`).

import axios from 'axios';
import type { CloudResponse, LLMChatPayload } from '../cloud/types.js';
import type { KeyValidation, ProviderClient, ProviderName } from './types.js';
import { normalizeModelId, sanitizeOpenAiMessages } from './model_id.js';

export interface OpenAiCompatibleConfig {
  name: ProviderName;
  label: string;
  signupUrl: string;
  /** Modelo por defecto (sin prefijo de proveedor). */
  defaultModel: string;
  /** baseUrl fija (p.ej. https://api.deepseek.com/v1). */
  baseUrl: string;
  /** Env que sobrescribe baseUrl (patrón swarm-ide: SWARM_<P>_BASE_URL). */
  baseUrlEnv?: string;
  /** Resolver lazy con prioridad máxima (p.ej. 'local' deriva de OLLAMA_URL). */
  baseUrlResolver?: () => string | undefined;
  /** Env de la API key. */
  keyEnv: string;
  /** Para 'local' (Ollama, etc.): la key puede faltar y no es un error. */
  keyOptional?: boolean;
  /** Cabeceras extra (p.ej. OpenRouter Referer/Title). */
  extraHeaders?: Record<string, string>;
}

export function makeOpenAiCompatibleClient(cfg: OpenAiCompatibleConfig): ProviderClient {
  const resolveBaseUrl = (): string => {
    const fromResolver = cfg.baseUrlResolver?.();
    const fromEnv = cfg.baseUrlEnv ? process.env[cfg.baseUrlEnv] : undefined;
    const base = (fromResolver && fromResolver.trim()) || (fromEnv && fromEnv.trim()) || cfg.baseUrl;
    return base.replace(/\/+$/, ''); // sin barra final
  };

  return {
    name: cfg.name,
    defaultModel: () => cfg.defaultModel,
    signupUrl: () => cfg.signupUrl,
    label: () => cfg.label,

    async invokeLLM(payload: LLMChatPayload): Promise<CloudResponse> {
      const key = process.env[cfg.keyEnv] || process.env.SHINOBI_PROVIDER_KEY;
      if (!key && !cfg.keyOptional) {
        return { success: false, output: '', error: `${cfg.label}: define ${cfg.keyEnv}.` };
      }
      const baseUrl = resolveBaseUrl();
      const model = normalizeModelId(payload.model || process.env.SHINOBI_MODEL_DEFAULT, cfg.name, cfg.defaultModel);
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(cfg.extraHeaders || {}) };
      if (key) headers.Authorization = `Bearer ${key}`;
      try {
        const resp = await axios.post(`${baseUrl}/chat/completions`, {
          model,
          messages: sanitizeOpenAiMessages(payload.messages),
          tools: payload.tools,
          tool_choice: payload.tool_choice,
          temperature: payload.temperature,
          max_tokens: payload.max_tokens,
        }, { headers, timeout: 60000 });
        const msg = resp.data?.choices?.[0]?.message;
        if (!msg) return { success: false, output: '', error: `${cfg.label}: respuesta vacía (${JSON.stringify(resp.data).slice(0, 160)})` };
        const usage = resp.data?.usage ? {
          prompt_tokens: resp.data.usage.prompt_tokens || 0,
          completion_tokens: resp.data.usage.completion_tokens || 0,
          total_tokens: resp.data.usage.total_tokens || 0,
        } : undefined;
        return { success: true, output: JSON.stringify(msg), error: '', usage };
      } catch (e: any) {
        if (e.response?.status === 401) return { success: false, output: '', error: `${cfg.label} HTTP 401: key inválida.` };
        if (e.response?.data?.error?.message) return { success: false, output: '', error: `${cfg.label}: ${e.response.data.error.message}` };
        // Endpoint local caído → error de conexión claro para el clasificador de failover.
        return { success: false, output: '', error: `${cfg.label} error [${model}]: ${e.message}` };
      }
    },

    async validateKey(key: string): Promise<KeyValidation> {
      const baseUrl = resolveBaseUrl();
      const trimmed = (key || '').trim();
      if (!trimmed && !cfg.keyOptional) return { ok: false, error: 'La key está vacía.' };
      try {
        const headers: Record<string, string> = { ...(cfg.extraHeaders || {}) };
        if (trimmed) headers.Authorization = `Bearer ${trimmed}`;
        const resp = await axios.get(`${baseUrl}/models`, { headers, timeout: 10000 });
        if (resp.status === 200) return { ok: true, status: 200 };
        return { ok: false, error: `${cfg.label} respondió status ${resp.status}.`, status: resp.status };
      } catch (e: any) {
        const status = e.response?.status;
        if (status === 401) return { ok: false, status: 401, error: `Key inválida (${cfg.label} devolvió 401).` };
        if (status === 429) return { ok: false, status: 429, error: `${cfg.label} rate-limit. Reintenta en unos segundos.` };
        return { ok: false, error: `${cfg.label} error: ${e.message}` };
      }
    },
  };
}
