// Habilidad A — adapter from existing LLMGateway to the LLMClient shape RepoReader expects.
// Routes through OpenRouter when OPENROUTER_API_KEY is set, otherwise falls back to OPENAI/GROQ.

import { LLMGateway } from '../gateway/llm.js';
import type { LLMClient } from './SubAgent.js';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';

const OPENROUTER_ALIAS: Record<string, string> = {
  // Logical names actuales (post S1.5 remapping):
  'claude-sonnet-4-6': 'anthropic/claude-sonnet-4.6',
  'claude-opus-4-7':   'anthropic/claude-opus-4.7',
  // Back-compat para tests y código legacy que aún referencia haiku-4-5:
  'claude-haiku-4-5':  'anthropic/claude-haiku-4.5',
};

// Fallback when OPENROUTER_API_KEY is not set: route to OpenAI directly using
// approximate equivalents so logical names still resolve to a real model id
// rather than producing a 404.
const OPENAI_FALLBACK: Record<string, string> = {
  'claude-sonnet-4-6': 'gpt-4o',
  'claude-opus-4-7':   'gpt-4o',
  'claude-haiku-4-5':  'gpt-4o-mini',
  'z-ai/glm-4.7-flash':'gpt-4o-mini',  // glm vía OpenRouter no tiene alias, pero si OpenAI fallback lo recibe lo bajamos a 4o-mini
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
      const logical = opts?.model ?? 'z-ai/glm-4.7-flash';
      const temperature = opts?.temperature ?? defaults.temperature;
      if (orKey) {
        const model = OPENROUTER_ALIAS[logical] ?? logical;
        return gateway.chat(messages as any, {
          provider: 'openai',
          model,
          apiKey: orKey,
          baseUrl: OPENROUTER_BASE,
          temperature,
        });
      }
      const model = OPENAI_FALLBACK[logical] ?? logical;
      return gateway.chat(messages as any, { provider: 'openai', model, temperature });
    },
  };
}
