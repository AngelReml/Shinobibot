// Plan Hermes — consult_models (varios modelos opinan y uno sintetiza).
import { describe, it, expect } from 'vitest';
import tool, { parsePanelSpec, resolvePanel, runPanel, MOA_MAX_MEMBERS, type AskFn, type AggregateFn, type PanelMember } from '../consult_models.js';
import { getTool } from '../tool_registry.js';

const A: PanelMember = { provider: 'anthropic', model: 'claude-haiku-4-5' };
const B: PanelMember = { provider: 'groq', model: 'llama' };
const C: PanelMember = { provider: 'openai', model: 'gpt' };

describe('consult_models', () => {
  it('se registra como tool', () => {
    expect(getTool('consult_models')).toBeDefined();
  });

  it('lee el panel de SHINOBI_MOA_MODELS, descarta lo mal escrito, los duplicados y el exceso', () => {
    expect(parsePanelSpec('anthropic:claude-haiku-4-5, groq:llama-3.3 ,inventado:x,openai:,sinmodelo,groq:llama-3.3')).toEqual([
      { provider: 'anthropic', model: 'claude-haiku-4-5' }, { provider: 'groq', model: 'llama-3.3' },
    ]);
    expect(parsePanelSpec('openrouter:meta/llama:free')).toEqual([{ provider: 'openrouter', model: 'meta/llama:free' }]);
    expect(parsePanelSpec(Array.from({ length: 9 }, (_, i) => `groq:m${i}`).join(','))).toHaveLength(MOA_MAX_MEMBERS);
  });

  it('panel explícito: solo entran los proveedores con clave', () => {
    const env = { SHINOBI_MOA_MODELS: 'anthropic:a,groq:b' } as any;
    expect(resolvePanel(env, (p) => p === 'anthropic', () => 'x')).toEqual([{ provider: 'anthropic', model: 'a' }]);
  });

  it('panel por defecto: un modelo por proveedor con clave; con solo Anthropic, dos Claude distintos', () => {
    const def = (p: string) => `${p}-default`;
    expect(resolvePanel({} as any, (p) => p === 'anthropic' || p === 'groq', def as any)).toEqual([
      { provider: 'anthropic', model: 'anthropic-default' }, { provider: 'groq', model: 'groq-default' },
    ]);
    const solo = resolvePanel({} as any, (p) => p === 'anthropic', (() => 'claude-haiku-4-5') as any);
    expect(solo).toHaveLength(2);
    expect(new Set(solo.map(m => m.model)).size).toBe(2);
    expect(resolvePanel({} as any, () => false, def as any)).toEqual([]);
  });

  it('pregunta a todos en paralelo y pasa las respuestas al agregador como datos etiquetados', async () => {
    const asked: string[] = [];
    const ask: AskFn = async (m, _s, q) => { asked.push(`${m.provider}|${q}`); return { ok: true, text: `respuesta de ${m.provider}` }; };
    let seen = { system: '', user: '' };
    const aggregate: AggregateFn = async (system, user) => { seen = { system, user }; return { ok: true, text: 'SÍNTESIS' }; };
    const r = await runPanel('¿2+2?', [A, B], ask, aggregate);
    expect(r.ok).toBe(true);
    expect(asked).toEqual(['anthropic|¿2+2?', 'groq|¿2+2?']);
    expect(seen.system).toMatch(/DATA/);
    expect(seen.user).toContain('<question>\n¿2+2?\n</question>');
    expect(seen.user).toContain('<answer n="1" model="anthropic:claude-haiku-4-5">\nrespuesta de anthropic\n</answer>');
    expect(r.output).toContain('SÍNTESIS');
    expect(r.output).toContain('anthropic:claude-haiku-4-5 ✓');
  });

  it('sigue con los que respondan si uno falla o lanza, y lo declara', async () => {
    const ask: AskFn = async (m) => {
      if (m.provider === 'groq') throw new Error('timeout');
      if (m.provider === 'openai') return { ok: true, text: '   ' };
      return { ok: true, text: 'vale' };
    };
    const D: PanelMember = { provider: 'gemini', model: 'g' };
    const r = await runPanel('q', [A, B, C, D], ask, async () => ({ ok: true, text: 'S' }));
    expect(r.ok).toBe(true);
    expect(r.proposals.map(p => p.ok)).toEqual([true, false, false, true]);
    expect(r.output).toContain('groq:llama ✗ (timeout)');
  });

  it('con menos de 2 respuestas no hay panel: falla sin llamar al agregador', async () => {
    let called = false;
    const ask: AskFn = async (m) => m.provider === 'anthropic' ? { ok: true, text: 'sola' } : { ok: false, text: '', error: '401' };
    const r = await runPanel('q', [A, B], ask, async () => { called = true; return { ok: true, text: 'S' }; });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Solo 1 de 2/);
    expect(called).toBe(false);
  });

  it('si la síntesis falla lo dice, y la tool valida la pregunta', async () => {
    const r = await runPanel('q', [A, B], async () => ({ ok: true, text: 'x' }), async () => ({ ok: false, text: '', error: 'rate limit' }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/síntesis falló: rate limit/);
    expect((await tool.execute({ question: '  ' })).success).toBe(false);
    expect((await tool.execute({ question: 'x'.repeat(13000) })).success).toBe(false);
  });
});
