import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { UsagePatternDetector } from '../usage_pattern_detector.js';
import { serializeSkillMd } from '../skill_md_parser.js';
import { verifySkillText, signSkillText } from '../skill_signing.js';

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'sk-usage-'));
});
afterEach(() => {
  try { if (existsSync(work)) rmSync(work, { recursive: true, force: true }); } catch {}
});

describe('UsagePatternDetector — record + threshold', () => {
  it('una sola ocurrencia no propone', () => {
    const d = new UsagePatternDetector();
    const r = d.recordSequence(['read_file', 'edit_file']);
    expect(r.proposed).toBe(false);
    expect(r.record?.count).toBe(1);
  });

  it('en la 3ª ocurrencia propone draft', () => {
    const d = new UsagePatternDetector();
    d.recordSequence(['read_file', 'search_files', 'edit_file']);
    d.recordSequence(['read_file', 'search_files', 'edit_file']);
    const r = d.recordSequence(['read_file', 'search_files', 'edit_file']);
    expect(r.proposed).toBe(true);
    expect(r.record?.count).toBe(3);
    expect(r.draft).toBeTruthy();
    expect(r.draft!.frontmatter.name).toMatch(/^auto-pattern-/);
    expect(r.draft!.frontmatter.status).toBe('pending_confirmation');
  });

  it('no propone dos veces el mismo patrón', () => {
    const d = new UsagePatternDetector();
    d.recordSequence(['a', 'b']);
    d.recordSequence(['a', 'b']);
    d.recordSequence(['a', 'b']);
    const r4 = d.recordSequence(['a', 'b']);
    expect(r4.proposed).toBe(false);
    expect(r4.record?.count).toBe(4);
  });

  it('secuencias distintas en orden son patrones distintos', () => {
    const d = new UsagePatternDetector();
    d.recordSequence(['a', 'b']);
    d.recordSequence(['a', 'b']);
    d.recordSequence(['b', 'a']);
    d.recordSequence(['b', 'a']);
    const snap = d.snapshot();
    expect(snap).toHaveLength(2);
    expect(snap.map(s => s.signature).sort()).toEqual(['a→b', 'b→a']);
  });

  it('secuencia más corta que minLength → no se registra', () => {
    const d = new UsagePatternDetector({ minLength: 2 });
    const r = d.recordSequence(['solo']);
    expect(r.proposed).toBe(false);
    expect(d.snapshot()).toEqual([]);
  });

  it('secuencia más larga que maxLength → no se registra', () => {
    const d = new UsagePatternDetector({ maxLength: 3 });
    const r = d.recordSequence(['a', 'b', 'c', 'd']);
    expect(r.proposed).toBe(false);
    expect(d.snapshot()).toEqual([]);
  });

  it('threshold custom = 2 dispara antes', () => {
    const d = new UsagePatternDetector({ threshold: 2 });
    d.recordSequence(['x', 'y']);
    const r = d.recordSequence(['x', 'y']);
    expect(r.proposed).toBe(true);
    expect(r.record?.count).toBe(2);
  });
});

describe('UsagePatternDetector — draft content', () => {
  it('draft tiene frontmatter mínimo y body con pasos', () => {
    const d = new UsagePatternDetector({ threshold: 2 });
    d.recordSequence(['lookup', 'transform', 'commit']);
    const r = d.recordSequence(['lookup', 'transform', 'commit']);
    expect(r.draft).toBeTruthy();
    const fm = r.draft!.frontmatter;
    expect(fm.name).toMatch(/^auto-pattern-/);
    expect(typeof fm.description).toBe('string');
    expect(fm.source).toBe('auto');
    expect(fm.source_kind).toBe('usage_pattern');
    expect(typeof fm.source_pattern_hash).toBe('string');
    expect(r.draft!.body).toContain('lookup');
    expect(r.draft!.body).toContain('transform');
    expect(r.draft!.body).toContain('commit');
  });

  it('el draft serializado se puede firmar y verificar', () => {
    const d = new UsagePatternDetector({ threshold: 2 });
    d.recordSequence(['a', 'b']);
    const r = d.recordSequence(['a', 'b']);
    const text = serializeSkillMd(r.draft!);
    const signed = signSkillText(text, { author: 'auto-pattern' });
    expect(verifySkillText(signed).valid).toBe(true);
  });

  it('draft.frontmatter.source_pattern_hash es determinista por signature', () => {
    const d1 = new UsagePatternDetector({ threshold: 1 });
    const r1 = d1.recordSequence(['x', 'y', 'z']);
    const d2 = new UsagePatternDetector({ threshold: 1 });
    const r2 = d2.recordSequence(['x', 'y', 'z']);
    expect(r1.draft?.frontmatter.source_pattern_hash).toBe(r2.draft?.frontmatter.source_pattern_hash);
  });
});

describe('UsagePatternDetector — persistencia', () => {
  it('saveToDisk + loadFromDisk preserva records', () => {
    const path = join(work, 'patterns.json');
    const d1 = new UsagePatternDetector({ persistPath: path, threshold: 5 });
    d1.recordSequence(['a', 'b']);
    d1.recordSequence(['a', 'b']);
    expect(existsSync(path)).toBe(true);
    const json = JSON.parse(readFileSync(path, 'utf-8'));
    expect(json.records).toHaveLength(1);
    expect(json.records[0].count).toBe(2);

    // Nuevo detector lee el archivo y continúa.
    const d2 = new UsagePatternDetector({ persistPath: path, threshold: 3 });
    d2.recordSequence(['a', 'b']);
    const r = d2.recordSequence(['a', 'b']);
    expect(r.proposed).toBe(false); // ahora son 4 pero el threshold es 3, ya cruzó antes... espera.
    // d2 ve 2 ocurrencias previas + 2 nuevas = 4. threshold=3 → debió proponer en la 3a (1ª de d2).
    expect(r.record?.count).toBe(4);
  });

  it('reset() limpia memoria y disco', () => {
    const path = join(work, 'patterns.json');
    const d = new UsagePatternDetector({ persistPath: path });
    d.recordSequence(['a', 'b']);
    d.reset();
    expect(d.snapshot()).toEqual([]);
    const json = JSON.parse(readFileSync(path, 'utf-8'));
    expect(json.records).toEqual([]);
  });
});

describe('UsagePatternDetector — snapshot orden', () => {
  it('snapshot ordenado desc por count', () => {
    const d = new UsagePatternDetector();
    d.recordSequence(['x', 'y']);
    d.recordSequence(['x', 'y']);
    d.recordSequence(['x', 'y']);
    d.recordSequence(['p', 'q']);
    d.recordSequence(['m', 'n']);
    d.recordSequence(['m', 'n']);
    const snap = d.snapshot();
    expect(snap[0].count).toBe(3);
    expect(snap[1].count).toBe(2);
    expect(snap[2].count).toBe(1);
  });
});
