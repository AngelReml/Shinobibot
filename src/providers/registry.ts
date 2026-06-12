// src/providers/registry.ts
//
// Bloque 7.2 — registro DECLARATIVO de proveedores extra (absorbido de
// swarm-ide). En vez de un fichero-cliente por proveedor, los nuevos se
// declaran como datos y `makeOpenAiCompatibleClient` los materializa. Se montan
// SOBRE el motor de failover existente (provider_router): cooldowns,
// clasificación de error y audit siguen aplicando igual.
//
// Incluye 'local' = CUALQUIER endpoint OpenAI-compatible (Ollama, LM Studio,
// llama.cpp, vLLM). Deriva su baseUrl de SHINOBI_LOCAL_BASE_URL u OLLAMA_URL,
// y la key es opcional (Ollama no la pide). Es la pieza que cumple el norte:
// conectar a otro cerebro sin fricción.

import type { ProviderClient, ProviderName } from './types.js';
import { makeOpenAiCompatibleClient } from './openai_compatible.js';

/** Resuelve la baseUrl del endpoint local en runtime (no en import). */
function localBaseUrl(): string {
  const explicit = process.env.SHINOBI_LOCAL_BASE_URL;
  if (explicit && explicit.trim()) return explicit.trim();
  const ollama = process.env.OLLAMA_URL;
  if (ollama && ollama.trim()) {
    const base = ollama.trim().replace(/\/+$/, '');
    return /\/v\d+$/.test(base) ? base : `${base}/v1`; // Ollama OpenAI-compat vive en /v1
  }
  return 'http://localhost:11434/v1';
}

/** Proveedores extra, como datos. Adding one = una línea. */
export const EXTRA_PROVIDERS: ProviderClient[] = [
  makeOpenAiCompatibleClient({
    name: 'glm', label: 'GLM (Zhipu)', signupUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    keyEnv: 'GLM_API_KEY', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', baseUrlEnv: 'SHINOBI_GLM_BASE_URL',
    defaultModel: 'glm-4-flash',
  }),
  makeOpenAiCompatibleClient({
    name: 'gemini', label: 'Google Gemini', signupUrl: 'https://aistudio.google.com/apikey',
    keyEnv: 'GEMINI_API_KEY', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', baseUrlEnv: 'SHINOBI_GEMINI_BASE_URL',
    defaultModel: 'gemini-2.0-flash',
  }),
  makeOpenAiCompatibleClient({
    name: 'deepseek', label: 'DeepSeek', signupUrl: 'https://platform.deepseek.com/api_keys',
    keyEnv: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com/v1', baseUrlEnv: 'SHINOBI_DEEPSEEK_BASE_URL',
    defaultModel: 'deepseek-chat',
  }),
  makeOpenAiCompatibleClient({
    name: 'huggingface', label: 'HuggingFace', signupUrl: 'https://huggingface.co/settings/tokens',
    keyEnv: 'HF_TOKEN', baseUrl: 'https://router.huggingface.co/v1', baseUrlEnv: 'SHINOBI_HF_BASE_URL',
    defaultModel: 'Qwen/Qwen2.5-Coder-32B-Instruct',
  }),
  makeOpenAiCompatibleClient({
    name: 'local', label: 'Modelo local', signupUrl: 'https://ollama.com',
    keyEnv: 'SHINOBI_LOCAL_API_KEY', keyOptional: true,
    baseUrl: 'http://localhost:11434/v1', baseUrlResolver: localBaseUrl,
    defaultModel: process.env.SHINOBI_LOCAL_MODEL || 'llama3.2',
  }),
];

export const EXTRA_CLIENTS: Record<string, ProviderClient> =
  Object.fromEntries(EXTRA_PROVIDERS.map((c) => [c.name, c]));

export const EXTRA_PROVIDER_NAMES: ProviderName[] = EXTRA_PROVIDERS.map((c) => c.name);

/**
 * ¿Está configurado este proveedor? (key presente, o 'local' con endpoint).
 * La UI lo usa para mostrar solo lo conectable y marcar el resto como "añade key".
 */
export function isProviderConfigured(name: string): boolean {
  switch (name) {
    case 'groq': return !!process.env.GROQ_API_KEY;
    case 'openai': return !!process.env.OPENAI_API_KEY;
    case 'anthropic': return !!process.env.ANTHROPIC_API_KEY;
    case 'openrouter': return !!process.env.OPENROUTER_API_KEY;
    case 'glm': return !!process.env.GLM_API_KEY;
    case 'gemini': return !!process.env.GEMINI_API_KEY;
    case 'deepseek': return !!process.env.DEEPSEEK_API_KEY;
    case 'huggingface': return !!(process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN);
    case 'local': return !!(process.env.SHINOBI_LOCAL_BASE_URL || process.env.OLLAMA_URL || process.env.SHINOBI_LOCAL_MODEL);
    default: return false;
  }
}

/** Sugerencias de modelo para el selector, por proveedor (las que añade el registro). */
export const EXTRA_MODEL_SUGGESTIONS: Array<{ id: string; label: string; tier: string }> = [
  { id: 'glm-4-flash', label: 'GLM-4 Flash (gratis-ish)', tier: 'fast' },
  { id: 'glm-4-plus', label: 'GLM-4 Plus', tier: 'reasoning' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', tier: 'fast' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tier: 'reasoning' },
  { id: 'deepseek-chat', label: 'DeepSeek V3', tier: 'balanced' },
  { id: 'deepseek-reasoner', label: 'DeepSeek R1', tier: 'reasoning' },
  { id: 'Qwen/Qwen2.5-Coder-32B-Instruct', label: 'Qwen2.5 Coder 32B (HF)', tier: 'balanced' },
];
