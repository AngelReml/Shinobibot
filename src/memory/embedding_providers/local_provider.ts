/**
 * Local embedding backend via `@huggingface/transformers` (Transformers.js)
 * ejecutando `Xenova/all-MiniLM-L6-v2` por ONNX runtime.
 *
 * - Modelo: 22 MB (descarga única al primer uso, cacheada en
 *   `~/.cache/huggingface/`).
 * - Dim: 384.
 * - Latencia: ~30 ms por texto en CPU moderno; embedBatch baja a ~5-10 ms
 *   por texto.
 * - Pros: cero coste, offline tras descarga, calidad muy superior al hash.
 * - Contras: primera llamada espera el download del modelo (~3-10 s).
 *
 * El cargado es lazy: el pipeline solo se inicializa cuando se llama
 * `embed`/`embedBatch`/`isReady`. Así un proceso que no usa memoria
 * vectorial NO paga el coste de import del módulo.
 */

import { l2Normalize, type EmbeddingBackend } from './types.js';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const DIM = 384;

type FeatureExtractor = (texts: string | string[], options: { pooling: 'mean'; normalize: boolean }) => Promise<{
  tolist(): number[] | number[][];
}>;

let _extractorPromise: Promise<FeatureExtractor> | null = null;

async function getExtractor(): Promise<FeatureExtractor> {
  if (!_extractorPromise) {
    _extractorPromise = (async () => {
      // Dynamic import para que el bundle no cargue Transformers.js en arranque.
      const mod: any = await import('@huggingface/transformers');
      const pipeline = mod.pipeline ?? mod.default?.pipeline;
      if (typeof pipeline !== 'function') {
        throw new Error('@huggingface/transformers: pipeline() no disponible');
      }
      return await pipeline('feature-extraction', MODEL_ID, { dtype: 'fp32' });
    })();
  }
  return _extractorPromise;
}

export class LocalEmbeddingProvider implements EmbeddingBackend {
  readonly name = 'local';
  readonly dim = DIM;

  async isReady(): Promise<boolean> {
    try {
      await getExtractor();
      return true;
    } catch {
      return false;
    }
  }

  async embed(text: string): Promise<number[]> {
    const fx = await getExtractor();
    const tensor = await fx(text || ' ', { pooling: 'mean', normalize: true });
    const arr = tensor.tolist();
    // tolist() para input string devuelve number[][] de 1 fila; lo aplanamos.
    const vec = Array.isArray(arr[0]) ? (arr[0] as number[]) : (arr as unknown as number[]);
    // El pipeline ya normaliza con `normalize: true`, pero hacemos un pase
    // adicional por si llegara a caer en edge cases (texto vacío, etc.).
    return l2Normalize(vec.length === DIM ? vec : padOrTruncate(vec, DIM));
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const fx = await getExtractor();
    const safe = texts.map(t => (t && t.length > 0 ? t : ' '));
    const tensor = await fx(safe, { pooling: 'mean', normalize: true });
    const rows = tensor.tolist() as number[][];
    return rows.map(v => l2Normalize(v.length === DIM ? v : padOrTruncate(v, DIM)));
  }
}

function padOrTruncate(v: number[], dim: number): number[] {
  if (v.length === dim) return v;
  if (v.length > dim) return v.slice(0, dim);
  return [...v, ...new Array(dim - v.length).fill(0)];
}
