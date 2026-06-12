// Paridad con el question_scorer.py OFICIAL de GAIA
// (huggingface.co/spaces/gaia-benchmark/leaderboard/raw/main/scorer.py).
// Cada caso refleja el comportamiento exacto del oficial; si el port diverge,
// el número de la cata sería falso. Por eso se fija aquí.
import { describe, it, expect } from 'vitest';
import { gaiaScorer, extractFinalAnswer } from '../gaia_matcher.js';

describe('gaiaScorer · rama numérica', () => {
  it('número exacto', () => {
    expect(gaiaScorer('17', '17')).toBe(true);
    expect(gaiaScorer('17.0', '17')).toBe(true); // float('17.0')==float('17')
    expect(gaiaScorer('18', '17')).toBe(false);
  });
  it('quita $, % y comas antes de comparar', () => {
    expect(gaiaScorer('$1,234', '1234')).toBe(true);
    expect(gaiaScorer('42%', '42')).toBe(true);
    expect(gaiaScorer('1,000,000', '1000000')).toBe(true);
  });
  it('decimal de GAIA (0.1777)', () => {
    expect(gaiaScorer('0.1777', '0.1777')).toBe(true);
    expect(gaiaScorer('.1777', '0.1777')).toBe(true); // Number('.1777')==0.1777
    expect(gaiaScorer('0.1778', '0.1777')).toBe(false);
  });
  it('respuesta no numérica contra GT numérico → Infinity, no coincide', () => {
    expect(gaiaScorer('about seventeen', '17')).toBe(false);
  });
});

describe('gaiaScorer · rama lista (coma/;)', () => {
  it('lista de strings, orden y normalización sin puntuación-strip', () => {
    expect(gaiaScorer('apple, banana', 'apple, banana')).toBe(true);
    expect(gaiaScorer('Apple,  Banana', 'apple, banana')).toBe(true); // lower + sin espacios
  });
  it('distinta longitud → false', () => {
    expect(gaiaScorer('a, b, c', 'a, b')).toBe(false);
  });
  it('lista numérica compara como float por elemento', () => {
    expect(gaiaScorer('1, 2, 3', '1, 2, 3')).toBe(true);
    expect(gaiaScorer('1.0, 2, 3', '1, 2, 3')).toBe(true);
    expect(gaiaScorer('1, 2, 4', '1, 2, 3')).toBe(false);
  });
  it('separador ; también dispara la rama lista', () => {
    expect(gaiaScorer('x; y', 'x; y')).toBe(true);
  });
  it('lista mixta número+string', () => {
    expect(gaiaScorer('Paris, 5', 'paris, 5')).toBe(true);
    expect(gaiaScorer('Paris, 6', 'paris, 5')).toBe(false);
  });
  it('en elementos de lista NO se quita puntuación (remove_punct=False)', () => {
    // "a.b" vs "a.b" coincide; "ab" vs "a.b" NO (la puntuación cuenta en listas)
    expect(gaiaScorer('a.b, c', 'a.b, c')).toBe(true);
    expect(gaiaScorer('ab, c', 'a.b, c')).toBe(false);
  });
});

describe('gaiaScorer · rama string', () => {
  it('normaliza espacios, caso y puntuación', () => {
    expect(gaiaScorer('Washington, D.C.'.replace(',', ''), 'Washington DC')).toBe(true);
    expect(gaiaScorer('  the   ANSWER!! ', 'theanswer')).toBe(true);
  });
  it('quita TODA la puntuación en strings sueltos (remove_punct=True)', () => {
    expect(gaiaScorer('a.b.c', 'abc')).toBe(true);
  });
  it('strings distintos → false', () => {
    expect(gaiaScorer('cat', 'dog')).toBe(false);
  });
});

describe('gaiaScorer · bordes (paridad con el oficial)', () => {
  it('model_answer null/undefined → "None" (igual que el oficial)', () => {
    // normalize_str("None") = "none"; coincide solo si GT normaliza a "none".
    expect(gaiaScorer(null, 'None')).toBe(true);
    expect(gaiaScorer(undefined, 'none')).toBe(true);
    expect(gaiaScorer(null, '17')).toBe(false); // GT numérico: "None"→Infinity
    expect(gaiaScorer(null, 'cat')).toBe(false);
  });
  it('respuesta vacía no coincide con GT no vacío', () => {
    expect(gaiaScorer('', 'cat')).toBe(false);
  });
});

describe('extractFinalAnswer', () => {
  it('extrae tras el marcador', () => {
    expect(extractFinalAnswer('blah blah\nFINAL ANSWER: 17')).toBe('17');
    expect(extractFinalAnswer('FINAL ANSWER:   Paris  ')).toBe('Paris');
  });
  it('toma la primera línea tras el marcador', () => {
    expect(extractFinalAnswer('FINAL ANSWER: 42\nnotas extra')).toBe('42');
  });
  it('sin marcador → última línea no vacía', () => {
    expect(extractFinalAnswer('linea 1\nlinea 2\n')).toBe('linea 2');
  });
  it('vacío → cadena vacía', () => {
    expect(extractFinalAnswer('')).toBe('');
  });
});
