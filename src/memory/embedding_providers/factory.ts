/**
 * Factory + singleton para el backend de embeddings activo.
 *
 * Selección (en orden):
 *   1. `SHINOBI_EMBED_PROVIDER` env explícito (`local` | `openai` | `hash`).
 *   2. Autodetect: si `@huggingface/transformers` está disponible → `local`.
 *   3. Si hay `OPENAI_API_KEY` → `openai`.
 *   4. Fallback determinístico `hash`.
 *
 * El backend se mantiene cacheado para evitar reinicializar el pipeline
 * (en el caso local, cargar el modelo ONNX cuesta segundos).
 */

import { HashEmbeddingProvider } from './hash_provider.js';
import { LocalEmbeddingProvider } from './local_provider.js';
import { OpenAIEmbeddingProvider } from './openai_provider.js';
import type { EmbeddingBackend, EmbeddingProviderName } from './types.js';

let _cached: EmbeddingBackend | null = null;
let _cachedName: EmbeddingProviderName | null = null;

/** Reset interno (uso en tests). */
export function _resetEmbeddingBackend(): void {
  _cached = null;
  _cachedName = null;
}

function pickProviderName(): EmbeddingProviderName {
  const explicit = (process.env.SHINOBI_EMBED_PROVIDER || '').toLowerCase();
  if (explicit === 'local' || explicit === 'openai' || explicit === 'hash') {
    return explicit;
  }
  // Autodetect: el módulo está instalado en package.json → asumimos local.
  // Si el usuario quiere openai, lo declara explícito.
  try {
    // require.resolve sin ejecutar el módulo — solo verifica que existe en disk.
    // (No usamos createRequire por consistencia con el resto del repo.)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    if (process.env.SHINOBI_FORCE_HASH_EMBED === '1') return 'hash';
    return 'local';
  } catch {
    if (process.env.OPENAI_API_KEY) return 'openai';
    return 'hash';
  }
}

export async function getEmbeddingBackend(): Promise<EmbeddingBackend> {
  const want = pickProviderName();
  if (_cached && _cachedName === want) return _cached;

  let backend: EmbeddingBackend;
  switch (want) {
    case 'openai':
      backend = new OpenAIEmbeddingProvider();
      break;
    case 'hash':
      backend = new HashEmbeddingProvider();
      break;
    case 'local':
    default:
      backend = new LocalEmbeddingProvider();
      break;
  }
  _cached = backend;
  _cachedName = want;
  return backend;
}

export async function currentEmbeddingBackendName(): Promise<string> {
  const b = await getEmbeddingBackend();
  return b.name;
}
