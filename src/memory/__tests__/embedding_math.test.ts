// src/memory/__tests__/embedding_math.test.ts

import { describe, it, expect } from 'vitest';
import { cosineSimilarity } from '../embedding_math.js';

describe('cosineSimilarity', () => {
  it('vectores idénticos → similitud 1', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it('vectores ortogonales → similitud 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 6);
  });

  it('vectores opuestos → similitud -1', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
  });

  it('caso conocido: [1,2,3] vs [4,5,6] ≈ 0.9746', () => {
    expect(cosineSimilarity([1, 2, 3], [4, 5, 6])).toBeCloseTo(0.9746318461970762, 6);
  });

  it('dimensiones distintas devuelve 0 sin lanzar', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('vector cero devuelve 0 (evita division por cero)', () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
    expect(cosineSimilarity([0, 0, 0], [0, 0, 0])).toBe(0);
  });

  it('a o b nulos/undefined devuelve 0', () => {
    // @ts-expect-error prueba defensiva de runtime
    expect(cosineSimilarity(null, [1, 2])).toBe(0);
    // @ts-expect-error prueba defensiva de runtime
    expect(cosineSimilarity([1, 2], undefined)).toBe(0);
  });

  it('escala invariante: cosine(v, k*v) == 1 para k > 0', () => {
    const v = [3, -1, 2];
    const scaled = v.map((x) => x * 5);
    expect(cosineSimilarity(v, scaled)).toBeCloseTo(1, 6);
  });

  it('simetrica: cosine(a,b) == cosine(b,a)', () => {
    const a = [1, 2, 3];
    const b = [4, -5, 6];
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
  });
});
