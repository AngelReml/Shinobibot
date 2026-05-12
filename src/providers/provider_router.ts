// src/providers/provider_router.ts
//
// Bloque 7 — entrypoint único para el orchestrator. Dispatch al cliente
// correcto según `SHINOBI_PROVIDER` env. Default `opengravity` para
// back-compat con instalaciones legacy.
//
// Fallback chain:
//   - Si SHINOBI_PROVIDER=opengravity (default) y falla con connection
//     error → fallback a OpenRouter directo (preserva Bloque 1.1).
//   - Para los demás providers (groq/openai/anthropic/openrouter), si
//     fallan, devuelven el error tal cual — el usuario eligió ese
//     provider, respect.

import { OpenGravityClient } from '../cloud/opengravity_client.js';
import { invokeLLMViaOpenRouter, isConnectionError } from '../cloud/openrouter_fallback.js';
import { groqClient } from './groq_client.js';
import { openaiClient } from './openai_client.js';
import { anthropicClient } from './anthropic_client.js';
import { openrouterClient } from './openrouter_client.js';
import type { CloudResponse, LLMChatPayload } from '../cloud/types.js';
import type { ProviderClient, ProviderName } from './types.js';

const CLIENTS: Record<Exclude<ProviderName, 'opengravity'>, ProviderClient> = {
  groq: groqClient,
  openai: openaiClient,
  anthropic: anthropicClient,
  openrouter: openrouterClient,
};

export function getClient(name: ProviderName): ProviderClient | null {
  if (name === 'opengravity') return null;
  return CLIENTS[name] ?? null;
}

export function getAllUserFacingClients(): ProviderClient[] {
  // Orden para la UI: free first (Groq), después premium.
  return [groqClient, anthropicClient, openaiClient, openrouterClient];
}

export function currentProvider(): ProviderName {
  const p = (process.env.SHINOBI_PROVIDER || '').toLowerCase();
  if (p === 'groq' || p === 'openai' || p === 'anthropic' || p === 'openrouter') return p;
  return 'opengravity';
}

export async function invokeLLM(payload: LLMChatPayload): Promise<CloudResponse> {
  const provider = currentProvider();

  if (provider === 'opengravity') {
    // Legacy path: OpenGravity primario + OpenRouter fallback (Bloque 1.1).
    let result = await OpenGravityClient.invokeLLM(payload);
    if (!result.success && isConnectionError(result.error)) {
      console.log('[Shinobi] OpenGravity gateway offline, using OpenRouter direct fallback');
      result = await invokeLLMViaOpenRouter(payload);
      if (result.success) console.log('[Shinobi] OpenRouter fallback OK.');
      else console.log(`[Shinobi] OpenRouter fallback failed: ${result.error}`);
    }
    return result;
  }

  const client = CLIENTS[provider];
  if (!client) {
    return { success: false, output: '', error: `Unknown SHINOBI_PROVIDER='${provider}'.` };
  }
  return await client.invokeLLM(payload);
}
