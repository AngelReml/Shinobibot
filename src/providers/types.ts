// src/providers/types.ts
//
// Bloque 7 — interfaz común que todos los clients de provider implementan.

import type { CloudResponse, LLMChatPayload } from '../cloud/types.js';

export type ProviderName = 'groq' | 'openai' | 'anthropic' | 'openrouter' | 'opengravity';

export interface KeyValidation {
  ok: boolean;
  /** Mensaje de error legible para mostrar al usuario en la UI de onboarding. */
  error?: string;
  /** HTTP status code observado (útil para logs). */
  status?: number;
}

export interface ProviderClient {
  readonly name: ProviderName;
  /** Default model para este provider — se pre-rellena al onboarding. */
  defaultModel(): string;
  /** URL pública de signup / management de keys. */
  signupUrl(): string;
  /** Pretty label para la UI. */
  label(): string;
  /**
   * Llama al LLM. Debe devolver `output` como JSON-stringify de un mensaje
   * OpenAI-compatible (`{role, content, tool_calls?}`).
   */
  invokeLLM(payload: LLMChatPayload): Promise<CloudResponse>;
  /**
   * Test ping — debe ser gratis (no consumir tokens). Devuelve `{ok, error?}`.
   * Normalmente GET /models o /auth/key con la key. 401 → ok:false.
   */
  validateKey(key: string): Promise<KeyValidation>;
}
