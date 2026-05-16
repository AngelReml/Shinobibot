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

import { createRequire } from 'module';
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
  if (process.env.SHINOBI_FORCE_HASH_EMBED === '1') return 'hash';
  // Autodetect: si `@huggingface/transformers` se resuelve en disco usamos
  // `local`. Si no (ej. build .exe sin el módulo bundle), caemos a `openai`
  // cuando hay key, o al `hash` determinístico como último recurso.
  try {
    const require = createRequire(import.meta.url);
    require.resolve('@huggingface/transformers');
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
