// Habilidad A — adapter from existing LLMGateway to the LLMClient shape RepoReader expects.
// Routes through OpenRouter when OPENROUTER_API_KEY is set, otherwise falls back to OPENAI/GROQ.

import { LLMGateway } from '../gateway/llm.js';
import type { LLMClient } from './SubAgent.js';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';

const OPENROUTER_ALIAS: Record<string, string> = {
  'claude-haiku-4-5': 'anthropic/claude-haiku-4.5',
  'claude-opus-4-7': 'anthropic/claude-opus-4.7',
};

// Fallback when OPENROUTER_API_KEY is not set: route to OpenAI directly using
// approximate equivalents so RepoReader's logical names still resolve to a
// real model id rather than producing a 404.
const OPENAI_FALLBACK: Record<string, string> = {
  'claude-haiku-4-5': 'gpt-4o-mini',
  'claude-opus-4-7': 'gpt-4o',
};

export interface MakeLLMClientOptions {
  /** Default temperature for every call. F1 uses 0 for stability. Undefined = provider default. */
  temperature?: number;
}

export function makeLLMClient(defaults: MakeLLMClientOptions = {}): LLMClient {
  const gateway = new LLMGateway();
  const orKey = process.env.OPENROUTER_API_KEY;
  return {
    async chat(messages, opts) {
      const logical = opts?.model ?? 'claude-haiku-4-5';
      const temperature = opts?.temperature ?? defaults.temperature;
      // S14 override: durante baselines/after S1.4 forzamos un único modelo en
      // toda la cadena (sub-agents + synth + committee + everything) para que
      // la comparación A/B mida el efecto del prompt, no el efecto del modelo.
      // Default OFF: solo activo cuando el runner setea S14_FORCE_MODEL.
      const forced = process.env.S14_FORCE_MODEL;
      if (orKey) {
        const model = forced ?? (OPENROUTER_ALIAS[logical] ?? logical);
        return gateway.chat(messages as any, {
          provider: 'openai',
          model,
          apiKey: orKey,
          baseUrl: OPENROUTER_BASE,
          temperature,
        });
      }
      const model = forced ?? (OPENAI_FALLBACK[logical] ?? logical);
      return gateway.chat(messages as any, { provider: 'openai', model, temperature });
    },
  };
}
