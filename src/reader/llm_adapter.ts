// Habilidad A — adapter from existing LLMGateway to the LLMClient shape RepoReader expects.
// Routes through OpenRouter when OPENROUTER_API_KEY is set, otherwise falls back to OpenAI direct.
//
// F4.4 (2026-07-01): the OPENAI_FALLBACK path used to substitute gpt-4o for
// whatever Claude model the caller asked for, SILENTLY, whenever
// OPENROUTER_API_KEY was missing — no log, no audit trail, nothing surfaced
// to the caller. A caller believing it got claude-sonnet-4-6 output could
// actually have gotten gpt-4o output with no way to tell. Fixed by: (1) every
// fallback is logged via audit.logFailover ("solicitado X, servido Y por
// falta de OPENROUTER_API_KEY") — auditable, not silent; (2) if the fallback
// provider ALSO has no usable key (no OPENAI_API_KEY), we fail loud instead
// of sending a request that will either 401 opaquely or (worse, if some
// proxy accepts keyless calls) run against a provider nobody asked for.

import { LLMGateway } from '../gateway/llm.js';
import { logFailover } from '../audit/audit_log.js';
import type { LLMClient } from './SubAgent.js';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';

// Logical model names used by the rest of the repo (src/providers/anthropic_client.ts
// DEFAULT_MODEL, provider registry) — these are real, resolvable names, not
// fictitious placeholders. Kept consistent with src/providers/ on purpose.
const OPENROUTER_ALIAS: Record<string, string> = {
  // Logical names actuales (post S1.5 remapping):
  'claude-sonnet-4-6': 'anthropic/claude-sonnet-4-6',
  'claude-opus-4-7':   'anthropic/claude-opus-4-7',
  // Back-compat para tests y código legacy que aún referencia haiku-4-5:
  'claude-haiku-4-5':  'anthropic/claude-haiku-4-5',
};

// Fallback when OPENROUTER_API_KEY is not set: route to OpenAI directly using
// approximate equivalents so logical names still resolve to a real model id
// rather than producing a 404. F4.4: this substitution is now ALWAYS logged
// (see logModelSubstitution below) — never applied in silence.
const OPENAI_FALLBACK: Record<string, string> = {
  'claude-sonnet-4-6': 'gpt-4o',
  'claude-opus-4-7':   'gpt-4o',
  'claude-haiku-4-5':  'gpt-4o-mini',
  'z-ai/glm-4.7-flash':'gpt-4o-mini',  // glm vía OpenRouter no tiene alias, pero si OpenAI fallback lo recibe lo bajamos a 4o-mini
};

export interface MakeLLMClientOptions {
  /** Default temperature for every call. F1 uses 0 for stability. Undefined = provider default. */
  temperature?: number;
  /** F4.4 — if true, throw instead of silently proceeding when neither
   *  OPENROUTER_API_KEY nor OPENAI_API_KEY is set (no way to reach the real
   *  provider). Default true: fail loud is the safe default for this adapter. */
  failLoudOnMissingKeys?: boolean;
}

export class NoLLMProviderKeyError extends Error {
  constructor(requestedModel: string) {
    super(
      `reader/llm_adapter: no se puede servir el modelo solicitado "${requestedModel}" — ` +
      `faltan OPENROUTER_API_KEY y OPENAI_API_KEY. Ninguna sustitución silenciosa: define una de las dos.`,
    );
    this.name = 'NoLLMProviderKeyError';
  }
}

/** F4.4 — audit the substitution instead of applying it silently. */
function logModelSubstitution(requested: string, served: string, reason: string): void {
  try {
    logFailover({ from: requested, to: served, reason });
  } catch {
    // El audit log ya loguea sus propios fallos de escritura (audit_log.ts);
    // si además falla aquí, no debe tumbar la llamada LLM en curso.
  }
  // También a stderr: visible incluso si el audit log está deshabilitado o
  // apunta a un path distinto — el operador NO debe enterarse tarde de que
  // recibió un modelo distinto al pedido.
  console.error(`[reader/llm_adapter] modelo solicitado="${requested}" servido="${served}" motivo="${reason}"`);
}

export function makeLLMClient(defaults: MakeLLMClientOptions = {}): LLMClient {
  const gateway = new LLMGateway();
  const orKey = process.env.OPENROUTER_API_KEY;
  const failLoud = defaults.failLoudOnMissingKeys ?? true;
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

      // No OPENROUTER_API_KEY → falling back to OpenAI direct.
      const oaKey = process.env.OPENAI_API_KEY;
      if (!oaKey && failLoud) {
        throw new NoLLMProviderKeyError(logical);
      }
      const model = OPENAI_FALLBACK[logical] ?? logical;
      logModelSubstitution(logical, model, 'OPENROUTER_API_KEY no definida — fallback a OpenAI directo');
      return gateway.chat(messages as any, { provider: 'openai', model, temperature });
    },
  };
}
