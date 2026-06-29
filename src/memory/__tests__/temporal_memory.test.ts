/**
 * TEST DE INVARIANTE TEMPORAL (E4 — Memoria temporal)
 *
 * Verifica que el self-check gate de MemoryStore filtra silenciosamente
 * las entradas expiradas o no-aún-activas antes de devolver resultados.
 *
 * Usa SQLite en memoria y el provider de embeddings hash (sin red).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { MemoryStore } from '../memory_store.js';

// Fuerza embeddings hash (determinísticos, sin red ni modelo ONNX).
process.env.SHINOBI_EMBED_PROVIDER = 'hash';

const PAST = new Date(Date.now() - 60_000).toISOString();   // hace 1 min
const FUTURE = new Date(Date.now() + 60_000).toISOString(); // en 1 min

describe('INVARIANTE TEMPORAL (E4 — self-check gate)', () => {
  let store: MemoryStore;

  beforeAll(async () => {
    store = new MemoryStore({ db_path: ':memory:' });
    // Almacena 4 entradas con distintas combinaciones de validez temporal.
    await store.store('entrada sin bounds — siempre activa', { category: 'test' });
    await store.store('entrada expirada — valid_until en el pasado', {
      category: 'test',
      valid_until: PAST,
    });
    await store.store('entrada futura — valid_from en el futuro', {
      category: 'test',
      valid_from: FUTURE,
    });
    await store.store('entrada activa — valid_from pasado, valid_until futuro', {
      category: 'test',
      valid_from: PAST,
      valid_until: FUTURE,
    });
  });

  it('entry sin bounds aparece en recall', async () => {
    const results = await store.recall({ query: 'sin bounds siempre activa', category: 'test', limit: 10 });
    const contents = results.map(r => r.entry.content);
    expect(contents.some(c => c.includes('sin bounds'))).toBe(true);
  });

  it('entry expirada (valid_until en el pasado) NO aparece en recall', async () => {
    const results = await store.recall({ query: 'expirada valid_until pasado', category: 'test', limit: 10 });
    const contents = results.map(r => r.entry.content);
    expect(contents.some(c => c.includes('expirada'))).toBe(false);
  });

  it('entry futura (valid_from en el futuro) NO aparece en recall', async () => {
    const results = await store.recall({ query: 'futura valid_from futuro', category: 'test', limit: 10 });
    const contents = results.map(r => r.entry.content);
    expect(contents.some(c => c.includes('futura'))).toBe(false);
  });

  it('entry activa (valid_from pasado + valid_until futuro) aparece en recall', async () => {
    const results = await store.recall({ query: 'activa valid_from pasado valid_until futuro', category: 'test', limit: 10 });
    const contents = results.map(r => r.entry.content);
    expect(contents.some(c => c.includes('activa'))).toBe(true);
  });

  it('store persiste los campos valid_from y valid_until en la entrada devuelta', async () => {
    const entry = await store.store('bounds verificados', {
      category: 'test',
      valid_from: PAST,
      valid_until: FUTURE,
    });
    expect(entry.valid_from).toBe(PAST);
    expect(entry.valid_until).toBe(FUTURE);
  });

  it('buildContextSection excluye entradas expiradas', async () => {
    const ctx = await store.buildContextSection('expirada', 5000);
    expect(ctx).not.toContain('expirada');
  });
});
