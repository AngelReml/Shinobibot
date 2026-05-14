import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { l2Normalize } from '../types.js';
import { HashEmbeddingProvider, hashEmbed } from '../hash_provider.js';
import { OpenAIEmbeddingProvider } from '../openai_provider.js';
import {
  getEmbeddingBackend,
  currentEmbeddingBackendName,
  _resetEmbeddingBackend,
} from '../factory.js';

beforeEach(() => {
  _resetEmbeddingBackend();
});
afterEach(() => {
  delete process.env.SHINOBI_EMBED_PROVIDER;
  delete process.env.SHINOBI_FORCE_HASH_EMBED;
  delete process.env.OPENAI_API_KEY;
  _resetEmbeddingBackend();
});

describe('l2Normalize', () => {
  it('produce vector con norma 1', () => {
    const v = l2Normalize([3, 4]);
    const norm = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
    expect(norm).toBeCloseTo(1, 6);
    expect(v).toEqual([0.6, 0.8]);
  });
  it('vector cero pasa sin dividir por cero', () => {
    expect(l2Normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });
  it('preserva la dimensión', () => {
    expect(l2Normalize([1, 2, 3, 4]).length).toBe(4);
  });
});

describe('HashEmbeddingProvider', () => {
  const p = new HashEmbeddingProvider();
  it('name=hash, dim=384', () => {
    expect(p.name).toBe('hash');
    expect(p.dim).toBe(384);
  });
  it('isReady siempre true (no requiere red ni modelo)', async () => {
    expect(await p.isReady()).toBe(true);
  });
  it('embed produce vector de dim correcta y normalizado', async () => {
    const v = await p.embed('hola mundo');
    expect(v.length).toBe(384);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 3);
  });
  it('determinístico: mismo texto → mismo vector', async () => {
    const a = await p.embed('test');
    const b = await p.embed('test');
    expect(a).toEqual(b);
  });
  it('embedBatch procesa N textos', async () => {
    const out = await p.embedBatch(['a', 'b', 'c']);
    expect(out.length).toBe(3);
    expect(out[0].length).toBe(384);
  });
  it('texto vacío no rompe', async () => {
    const v = await p.embed('');
    expect(v.length).toBe(384);
  });
});

describe('hashEmbed helper', () => {
  it('palabras distintas producen vectores distintos', () => {
    const a = hashEmbed('python', 384);
    const b = hashEmbed('rust', 384);
    expect(a).not.toEqual(b);
  });
  it('case-insensitive (mismo lower)', () => {
    expect(hashEmbed('Hola', 384)).toEqual(hashEmbed('hola', 384));
  });
});

describe('OpenAIEmbeddingProvider', () => {
  const p = new OpenAIEmbeddingProvider();
  it('metadata: name=openai, dim=1536', () => {
    expect(p.name).toBe('openai');
    expect(p.dim).toBe(1536);
  });
  it('isReady false sin OPENAI_API_KEY', async () => {
    delete process.env.OPENAI_API_KEY;
    expect(await p.isReady()).toBe(false);
  });
  it('isReady true con OPENAI_API_KEY presente (sin validar la key)', async () => {
    process.env.OPENAI_API_KEY = 'sk-fake-test';
    expect(await p.isReady()).toBe(true);
  });
  it('embedBatch sin key lanza error claro', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(p.embedBatch(['x'])).rejects.toThrow(/OPENAI_API_KEY/);
  });
  it('embedBatch con array vacío devuelve []', async () => {
    process.env.OPENAI_API_KEY = 'sk-fake';
    expect(await p.embedBatch([])).toEqual([]);
  });
});

describe('factory.getEmbeddingBackend', () => {
  it('SHINOBI_EMBED_PROVIDER=hash → HashEmbeddingProvider', async () => {
    process.env.SHINOBI_EMBED_PROVIDER = 'hash';
    const b = await getEmbeddingBackend();
    expect(b.name).toBe('hash');
    expect(b.dim).toBe(384);
  });
  it('SHINOBI_EMBED_PROVIDER=openai → OpenAIEmbeddingProvider', async () => {
    process.env.SHINOBI_EMBED_PROVIDER = 'openai';
    const b = await getEmbeddingBackend();
    expect(b.name).toBe('openai');
    expect(b.dim).toBe(1536);
  });
  it('SHINOBI_FORCE_HASH_EMBED=1 → hash aunque local sea posible', async () => {
    process.env.SHINOBI_FORCE_HASH_EMBED = '1';
    const b = await getEmbeddingBackend();
    expect(b.name).toBe('hash');
  });
  it('singleton: dos llamadas devuelven misma instancia con mismo env', async () => {
    process.env.SHINOBI_EMBED_PROVIDER = 'hash';
    const a = await getEmbeddingBackend();
    const b = await getEmbeddingBackend();
    expect(a).toBe(b);
  });
  it('cambio de env reset rehace el backend', async () => {
    process.env.SHINOBI_EMBED_PROVIDER = 'hash';
    const a = await getEmbeddingBackend();
    _resetEmbeddingBackend();
    process.env.SHINOBI_EMBED_PROVIDER = 'openai';
    const b = await getEmbeddingBackend();
    expect(a).not.toBe(b);
    expect(b.name).toBe('openai');
  });
  it('currentEmbeddingBackendName expone el name actual', async () => {
    process.env.SHINOBI_EMBED_PROVIDER = 'hash';
    expect(await currentEmbeddingBackendName()).toBe('hash');
  });
  it('default cuando no hay env: local (asumiendo @huggingface/transformers instalado)', async () => {
    delete process.env.SHINOBI_EMBED_PROVIDER;
    delete process.env.SHINOBI_FORCE_HASH_EMBED;
    const b = await getEmbeddingBackend();
    // No descargamos el modelo aquí — solo verificamos la selección.
    expect(['local', 'openai', 'hash']).toContain(b.name);
  });
});

describe('EmbeddingProvider fachada (compat con MemoryStore)', () => {
  it('cosineSimilarity sobre vectores normalizados', async () => {
    const { EmbeddingProvider } = await import('../../embedding_provider.js');
    const a = l2Normalize([1, 0, 0]);
    const b = l2Normalize([1, 0, 0]);
    const c = l2Normalize([0, 1, 0]);
    expect(EmbeddingProvider.cosineSimilarity(a, b)).toBeCloseTo(1, 6);
    expect(EmbeddingProvider.cosineSimilarity(a, c)).toBeCloseTo(0, 6);
  });
  it('cosineSimilarity con dims distintas devuelve 0 (no lanza)', async () => {
    const { EmbeddingProvider } = await import('../../embedding_provider.js');
    expect(EmbeddingProvider.cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });
  it('cosineSimilarity vector cero devuelve 0', async () => {
    const { EmbeddingProvider } = await import('../../embedding_provider.js');
    expect(EmbeddingProvider.cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });
});
