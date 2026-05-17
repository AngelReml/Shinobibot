import { describe, it, expect } from 'vitest';
import {
  citationLine,
  contextSection,
} from '../memory_citations.js';
import type { RecallResult } from '../types.js';

function fakeResult(over: Partial<RecallResult['entry']> = {}, score = 0.85, match: RecallResult['match_type'] = 'semantic'): RecallResult {
  return {
    entry: {
      id: 'mem-abc-1234',
      content: 'El cliente principal se llama Mateo y trabaja en frontend.',
      category: 'client',
      tags: [],
      created_at: '2026-01-01T00:00:00Z',
      last_accessed_at: '2026-05-14T10:00:00Z',
      access_count: 3,
      importance: 0.7,
      ...over,
    },
    score,
    match_type: match,
  };
}

describe('citationLine', () => {
  it('incluye id, score, categoría, match y content', () => {
    const line = citationLine(fakeResult());
    expect(line).toContain('memory:mem-abc-1234');
    expect(line).toContain('score=0.85');
    expect(line).toContain('cat=client');
    expect(line).toContain('match=semantic');
    expect(line).toContain('Mateo');
  });

  it('trunca contenidos largos con ellipsis', () => {
    const long = 'x'.repeat(500);
    const line = citationLine(fakeResult({ content: long }), { contentCap: 50 });
    expect(line.length).toBeLessThan(150);
    expect(line).toContain('…');
  });

  it('formato de score con precisión configurable', () => {
    const line = citationLine(fakeResult({}, 0.123456), { scorePrecision: 4 });
    expect(line).toContain('score=0.1235');
  });

  it('match keyword/tag/semantic visible', () => {
    expect(citationLine(fakeResult({}, 0.5, 'keyword'))).toContain('match=keyword');
    expect(citationLine(fakeResult({}, 0.5, 'tag'))).toContain('match=tag');
    expect(citationLine(fakeResult({}, 0.5, 'semantic'))).toContain('match=semantic');
  });

  it('categoría vacía cae a "general"', () => {
    const line = citationLine(fakeResult({ category: '' }));
    expect(line).toContain('cat=general');
  });
});

describe('contextSection', () => {
  it('lista vacía → string vacío', () => {
    expect(contextSection([])).toBe('');
  });

  it('incluye header, body y footer', () => {
    const out = contextSection([fakeResult()]);
    expect(out).toContain('Relevant memories from past interactions');
    expect(out).toContain('memory:mem-abc-1234');
    expect(out).toContain('/memory show');
    expect(out).toContain('/memory forget');
  });

  it('respeta maxChars (caps al exceder)', () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      fakeResult({ id: `m${i}`, content: 'y'.repeat(200) }),
    );
    const out = contextSection(many, 500);
    expect(out.length).toBeLessThanOrEqual(500 + 200); // header+footer estables
    // Y al menos una línea debe estar.
    expect(out).toContain('memory:m0');
  });

  it('inserta una línea por cada resultado dentro del cap', () => {
    const out = contextSection([
      fakeResult({ id: 'a' }, 0.9, 'semantic'),
      fakeResult({ id: 'b' }, 0.8, 'keyword'),
      fakeResult({ id: 'c' }, 0.7, 'tag'),
    ]);
    expect(out).toContain('memory:a');
    expect(out).toContain('memory:b');
    expect(out).toContain('memory:c');
  });
});
