// src/providers/provider_router.ts
//
// Bloque 7 — entrypoint único para el orchestrator. Dispatch al cliente
// correcto según `SHINOBI_PROVIDER` env. Default `opengravity` para
// back-compat con instalaciones legacy.
//
// Failover cross-provider (TIER S #2):
//   Cada llamada construye una cadena ordenada de providers a probar. Si el
//   provider actual falla con un error rotativo (rate-limit, transient, auth,
//   unknown), se loguea la rotación y se prueba el siguiente. Solo
//   `fatal_payload` (400 por schema/tool/format) corta la cadena, porque
//   rotar daría el mismo error.
//
//   Cadena por defecto: `[currentProvider, opengravity, openrouter, groq,
//   anthropic, openai]` sin duplicados. Configurable con
//   `SHINOBI_FAILOVER_CHAIN` (CSV).
//
//   Anti-loop: cada provider se prueba MAX 1 vez por invocación.

import { OpenGravityClient } from '../cloud/opengravity_client.js';
import { invokeLLMViaOpenRouter, isConnectionError } from '../cloud/openrouter_fallback.js';
import { groqClient } from './groq_client.js';
import { openaiClient } from './openai_client.js';
import { anthropicClient } from './anthropic_client.js';
import { openrouterClient } from './openrouter_client.js';
import {
  buildFailoverChain,
  classifyProviderError,
  reasonLabel,
  shouldFailover,
} from './failover.js';
import { logFailover } from '../audit/audit_log.js';
import { FailoverCooldown } from '../coordinator/failover_cooldown.js';
import type { CloudResponse, LLMChatPayload } from '../cloud/types.js';
import type { ProviderClient, ProviderName } from './types.js';

// Cooldown por provider: cuando uno acumula rate-limit/transient/auth
// repetidos se pone en cooldown con backoff exponencial. No sustituye a la
// rotación de `failover.ts` — decide CUÁNDO se puede reintentar un provider.
const cooldown = new FailoverCooldown();

/** Snapshot del estado de cooldown — consumido por `/admin/metrics`. */
export function failoverCooldownMetrics() {
  return cooldown.metrics();
}

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

/**
 * Llama al provider indicado, sin failover. Encapsula la rama legacy
 * opengravity (con su fallback intrínseco a OpenRouter directo cuando hay
 * connection error en el gateway).
 */
async function invokeSingleProvider(
  provider: ProviderName,
  payload: LLMChatPayload,
): Promise<CloudResponse> {
  if (provider === 'opengravity') {
    // Legacy path: OpenGravity primario + OpenRouter fallback (Bloque 1.1).
    // Se mantiene para no romper instalaciones que dependen del gateway.
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
    return { success: false, output: '', error: `Unknown provider '${provider}'.` };
  }
  return await client.invokeLLM(payload);
}

export async function invokeLLM(payload: LLMChatPayload): Promise<CloudResponse> {
  const provider = currentProvider();
  const fullChain = buildFailoverChain(provider, process.env.SHINOBI_FAILOVER_CHAIN);

  // Reordena la cadena: los providers en cooldown van al final (siguen
  // disponibles como último recurso si los demás fallan — el cooldown es
  // una preferencia, no una prohibición absoluta).
  const ready = fullChain.filter(p => cooldown.isAvailable(p));
  const cooled = fullChain.filter(p => !cooldown.isAvailable(p));
  if (cooled.length > 0) {
    console.log(`[Shinobi] Providers en cooldown, despriorizados: ${cooled.join(', ')}`);
  }
  const chain = [...ready, ...cooled];

  let lastResult: CloudResponse = { success: false, output: '', error: 'No providers tried.' };
  for (let i = 0; i < chain.length; i++) {
    const p = chain[i];
    const result = await invokeSingleProvider(p, payload);
    if (result.success) {
      cooldown.markSuccess(p);
      if (i > 0) {
        console.log(`[Shinobi] Provider OK after failover: ${chain[0]} → ${p}`);
      }
      return result;
    }

    lastResult = result;
    const klass = classifyProviderError(result.error);
    const isLast = i === chain.length - 1;

    // Registra el fallo en el cooldown si es un error que merece backoff.
    if (klass === 'rate_limit' || klass === 'transient' || klass === 'auth') {
      const cd = cooldown.markFailure(p, klass);
      if (cd.cooldownOpened) {
        console.log(`[Shinobi] Provider ${p} en cooldown ${cd.cooldownSec}s tras racha de fallos.`);
      }
    }

    if (!shouldFailover(klass)) {
      // fatal_payload — devolvemos inmediatamente, rotar no ayudaría.
      console.log(`[Shinobi] Provider ${p} returned fatal_payload error, not failing over.`);
      return result;
    }

    if (isLast) {
      console.log(`[Shinobi] Provider ${p} failed (${reasonLabel(klass)}) — chain exhausted.`);
      return result;
    }

    const next = chain[i + 1];
    if (klass === 'no_key') {
      // Silencioso — provider no estaba configurado, no es un fallo real.
      console.log(`[Shinobi] Skip ${p} (no key) → trying ${next}`);
    } else {
      console.log(`[Shinobi] Provider switched: ${p} → ${next} (${reasonLabel(klass)})`);
    }
    logFailover({ from: p, to: next, reason: reasonLabel(klass) });
  }

  return lastResult;
}
