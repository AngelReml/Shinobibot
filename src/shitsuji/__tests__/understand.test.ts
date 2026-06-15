/**
 * T-04 — COMPRENDER: NL → Intent, reference resolution cascade + disambiguation.
 * The LLM parse is faked; the deterministic resolution/ambiguity GATE is exercised.
 */
import { describe, it, expect } from 'vitest';
import { Atlas } from '../../chizu/atlas/atlas.js';
import type { AppCard } from '../../chizu/types.js';
import { understand, comprehend, intentReady, pendingQuestions, applyAnswer, type NLParse, type RefPhrase } from '../understand.js';

function mkCard(over: Partial<AppCard>): AppCard {
  return {
    app_id: 'id', display_name: 'X', install_type: 'registry', discovered_by: [],
    usage: { usage_score: 0.5, signal_sources: [] },
    characterization: { cli: { available: 'unknown', evidence: 'none' }, com_automation: 'unknown', scripting_sdk: 'unknown', uia: { class: 'unprobed' }, sandbox: { portable: 'unknown', needs_install: 'unknown', needs_network: 'unknown', needs_login: 'unknown', verdict: 'unknown' } },
    category: 'other', risk: { level: 'safe', reasons: [], becomes_protected_resource: false },
    automation_candidate_score: 0, provenance: { origin: 'TOOL_INTERNAL', channel: 'x', retrieved_at: 't', trust_tier: 2, session_seq: 0 }, mapped_at: 't',
    ...over,
  } as AppCard;
}

describe('shitsuji/understand — T-04 NL→Intent', () => {
  it('decomposes goals + resolves "mi programa de diseño" via Atlas to the dominant app_id (GATE U2)', () => {
    const atlas = new Atlas([
      mkCard({ app_id: 'figma', display_name: 'Figma', category: 'design', usage: { usage_score: 0.9, signal_sources: [] } }),
      mkCard({ app_id: 'paint', display_name: 'Paint', category: 'design', usage: { usage_score: 0.2, signal_sources: [] } }),
    ]);
    const parse: NLParse = {
      goals: [{ verb: 'editar', object: 'la foto' }, { verb: 'enviar', object: 'el resultado' }],
      references: [{ phrase: 'mi programa de diseño', kind: 'app', category: 'design' }],
    };
    const intent = understand('i1', 'edita la foto con mi programa de diseño y mándamela', parse, { atlas });
    expect(intent.goals.map((g) => g.verb)).toEqual(['editar', 'enviar']);
    const ref = intent.references[0];
    expect(ref.resolved_to).toBe('figma');     // dominant by usage
    expect(ref.method).toBe('atlas');
    expect(ref.confidence).toBeGreaterThanOrEqual(0.9);
    expect(intentReady(intent)).toBe(true);     // clear → no nagging
    expect(pendingQuestions(intent)).toEqual([]);
  });

  it('two equally-plausible design apps → ambiguity recorded, NOT ready, asks one concrete question (GATE U3, ⚑)', () => {
    const atlas = new Atlas([
      mkCard({ app_id: 'figma', display_name: 'Figma', category: 'design', usage: { usage_score: 0.8, signal_sources: [] } }),
      mkCard({ app_id: 'sketch', display_name: 'Sketch', category: 'design', usage: { usage_score: 0.75, signal_sources: [] } }),
    ]);
    const parse: NLParse = { goals: [{ verb: 'abrir', object: 'el diseño' }], references: [{ phrase: 'mi programa de diseño', kind: 'app', category: 'design' }] };
    const intent = understand('i2', 'abre mi programa de diseño', parse, { atlas });
    expect(intent.references[0].resolved_to).toBe('');     // did NOT guess on real data
    expect(intent.ambiguities).toHaveLength(1);
    expect(intent.ambiguities[0].options.sort()).toEqual(['figma', 'sketch']);
    expect(intentReady(intent)).toBe(false);
    const qs = pendingQuestions(intent);
    expect(qs).toHaveLength(1);
    expect(qs[0]).toMatch(/mi programa de diseño/);

    // user answers → becomes ready
    applyAnswer(intent, 'mi programa de diseño', 'sketch');
    expect(intent.references[0].resolved_to).toBe('sketch');
    expect(intent.references[0].method).toBe('asked_user');
    expect(intentReady(intent)).toBe(true);
  });

  it('never resolves to a FORBIDDEN app (Chizu excludes the dangerous)', () => {
    const atlas = new Atlas([
      mkCard({ app_id: 'shell', display_name: 'Admin Shell', category: 'system', usage: { usage_score: 0.99, signal_sources: [] }, risk: { level: 'forbidden', reasons: ['system_admin'], becomes_protected_resource: true } }),
      mkCard({ app_id: 'notepad', display_name: 'Notepad', category: 'system', usage: { usage_score: 0.3, signal_sources: [] } }),
    ]);
    const parse: NLParse = { goals: [{ verb: 'abrir', object: 'algo' }], references: [{ phrase: 'mi herramienta de sistema', kind: 'app', category: 'system' }] };
    const intent = understand('i3', 'abre mi herramienta de sistema', parse, { atlas });
    expect(intent.references[0].resolved_to).toBe('notepad');   // forbidden shell excluded despite higher usage
  });

  it('file reference: one hit resolves; several → ask which; none → asks to specify', () => {
    const one = understand('i4', 'edita la foto de la manzana', { goals: [{ verb: 'editar', object: 'foto' }], references: [{ phrase: 'la foto de la manzana', kind: 'file', query: 'manzana' }] }, { searchFiles: () => [{ path: '/u/apple.png' }] });
    expect(one.references[0].resolved_to).toBe('/u/apple.png');
    expect(intentReady(one)).toBe(true);

    const many = understand('i5', 'edita la foto', { goals: [{ verb: 'editar', object: 'foto' }], references: [{ phrase: 'la foto', kind: 'file', query: 'foto' }] }, { searchFiles: () => [{ path: '/u/a.png' }, { path: '/u/b.png' }] });
    expect(many.ambiguities).toHaveLength(1);
    expect(intentReady(many)).toBe(false);

    const none = understand('i6', 'edita la foto', { goals: [{ verb: 'editar', object: 'foto' }], references: [{ phrase: 'la foto', kind: 'file', query: 'foto' }] }, { searchFiles: () => [] });
    expect(none.references[0].resolved_to).toBe('');
    expect(none.ambiguities).toHaveLength(0);
    expect(pendingQuestions(none)[0]).toMatch(/No encontré/);
    expect(intentReady(none)).toBe(false);
  });

  it('comprehend(): runs the injected LLM parser then resolves', async () => {
    const parser = async (_u: string): Promise<NLParse> => ({ goals: [{ verb: 'guardar', object: 'el resultado' }], references: [{ phrase: 'la carpeta de siempre', kind: 'context' }] });
    const intent = await comprehend('i7', 'guárdalo en la carpeta de siempre', parser, { fromContext: () => 'C:/Users/me/Desktop' });
    expect(intent.references[0].resolved_to).toBe('C:/Users/me/Desktop');
    expect(intent.references[0].method).toBe('context');
    expect(intentReady(intent)).toBe(true);
  });
});
