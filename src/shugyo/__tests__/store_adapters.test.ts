/**
 * S-02/S-03 — store (skills + persisted PatternBook, idempotent) and the Kagami
 * publish seam (certified skill → measured CapabilityCell).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ShugyoStore } from '../store.js';
import { publishToKagami } from '../adapters.js';
import type { LearnedSkill, TransferablePattern } from '../types.js';

const stores: ShugyoStore[] = [];
const mem = () => { const s = new ShugyoStore({ db_path: ':memory:' }); stores.push(s); return s; };
afterEach(() => { while (stores.length) stores.pop()!.close(); });

const skill = (id: string, status: LearnedSkill['status']): LearnedSkill =>
  ({ skill_id: id, app_id: 'figma', capability_id: id.replace('.v1', ''), manifest_ref: id, status, grade: 'strong', provenance: { origin: 'AGENT_DERIVED', channel: 'shugyo', retrieved_at: 't', trust_tier: 2, session_seq: 0 } });

describe('shugyo/store — S-02', () => {
  it('idempotente + skills round-trip + filtro por status', () => {
    const s = mem();
    expect(() => new ShugyoStore({ db_path: s.dbPath })).not.toThrow();
    s.upsertSkill(skill('a.v1', 'candidate'));
    s.upsertSkill(skill('b.v1', 'certified'));
    expect(s.listSkills('certified').map((x) => x.skill_id)).toEqual(['b.v1']);
    expect(s.listSkills()).toHaveLength(2);
  });

  it('la curva sobrevive: PatternBook se persiste y rehidrata', () => {
    const s = mem();
    const p: TransferablePattern = { pattern_id: 'pat_export', idiom: 'export', cues: ['Export', 'Save As'], prior_procedure_hints: [], seen_in: ['figma'], hit_rate: 0.8 };
    s.savePattern(p);
    const book = s.loadPatternBook();
    expect(book.match(['export'])?.idiom).toBe('export');     // rehydrated, transfer survives
  });
});

describe('shugyo/adapters — S-03 publicar a Kagami', () => {
  it('skill certificada con medición fuerte → CapabilityCell RELIABLE (medido, no presumido)', () => {
    const cell = publishToKagami(skill('export.pdf.v1', 'certified'), { success_rate: 0.95, sample_size: 20, declared_confidence: 0.9, measured_at: 't', source_bank: 'cert_bank' });
    expect(cell.capability_id).toBe('export.pdf');
    expect(cell.verdict).toBe('RELIABLE');
  });
  it('skill floja → no RELIABLE (la frontera la marca la medición)', () => {
    const cell = publishToKagami(skill('hard.v1', 'certified'), { success_rate: 0.3, sample_size: 20, declared_confidence: 0.9, measured_at: 't', source_bank: 'cert_bank' });
    expect(cell.verdict).toBe('BEYOND_FRONTIER');
  });
});
