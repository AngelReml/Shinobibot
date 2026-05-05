// Habilidad A — adapter from existing LLMGateway to the LLMClient shape RepoReader expects.
// Routes through OpenRouter when OPENROUTER_API_KEY is set, otherwise falls back to OPENAI/GROQ.

import { LLMGateway } from '../gateway/llm.js';
import type { LLMClient } from './SubAgent.js';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';

const MODEL_ALIAS: Record<string, string> = {
  // logical name → OpenRouter model id
  'claude-haiku-4-5': 'anthropic/claude-haiku-4.5',
  'claude-opus-4-7': 'anthropic/claude-opus-4.7',
};

export function makeLLMClient(): LLMClient {
  const gateway = new LLMGateway();
  const orKey = process.env.OPENROUTER_API_KEY;
  return {
    async chat(messages, opts) {
      const model = opts?.model ? (MODEL_ALIAS[opts.model] ?? opts.model) : 'anthropic/claude-haiku-4.5';
      if (orKey) {
        return gateway.chat(messages as any, {
          provider: 'openai',
          model,
          apiKey: orKey,
          baseUrl: OPENROUTER_BASE,
        });
      }
      // Fallback for local dev without OpenRouter
      return gateway.chat(messages as any, { provider: 'openai', model: opts?.model ?? 'gpt-4o' });
    },
  };
}
