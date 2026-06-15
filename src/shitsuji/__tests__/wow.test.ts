/**
 * T-12 — EL PROMPT WOW (dossier §16). La orden cross-app del ejemplo de Iván,
 * EN SU VOZ, totalmente en lenguaje natural, corrida de punta a punta por el
 * conductor (serve). El wow no está en un prompt elaborado: está en que NO hace
 * falta elaborarlo — le hablas como a un humano experto y dispara todo el pipeline.
 *
 * Esto es la versión reproducible en CI: las puntas vivas (parser LLM, Drive,
 * programa de facturación) van FAKED; el operador solo las cambia por reales. Lo
 * que se demuestra es que el lenguaje natural fluye por COMPRENDER→PLANIFICAR→
 * FACTIBLE→APROBAR→EJECUTAR→VERIFICAR→TRAZA y produce el rastro paso-por-paso.
 */
import { describe, it, expect } from 'vitest';
import { Atlas } from '../../chizu/atlas/atlas.js';
import type { AppCard } from '../../chizu/types.js';
import { DirCageSandbox } from '../../shugyo/sandbox/revertible.js';
import { serve, type ServeDeps } from '../orchestrate.js';
import { makeRealExecutor, type SkillInvoker } from '../runtime.js';
import { type NLParse } from '../understand.js';
import { type StepSpec } from '../plan.js';
import type { Intent } from '../types.js';

const WOW = 'Shinobi: cógeme el último informe de la carpeta de la empresa en mi Drive, ' +
  'pásalo por mi programa de facturación para cuadrar los números, y guárdame el resultado ' +
  'en el escritorio. Si algo no te cuadra o no sabes hacerlo, paras y me lo dices — no me ' +
  'toques nada de lo que no estés seguro, y no me digas que está hecho si no lo está. Y ' +
  'déjame ver luego qué hiciste, paso por paso.';

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

// ⚑ FAKED LIVE SEAM 1: the strong model parsing the utterance.
const parse = async (_u: string): Promise<NLParse> => ({
  goals: [
    { verb: 'coger', object: 'el último informe' },
    { verb: 'cuadrar', object: 'los números' },
    { verb: 'guardar', object: 'el resultado' },
  ],
  references: [
    { phrase: 'la carpeta de la empresa en mi Drive', kind: 'file', query: 'informe empresa drive' },
    { phrase: 'mi programa de facturación', kind: 'app', category: 'office' },
  ],
});

const resolvers = {
  searchFiles: () => [{ path: '/Drive/Empresa/informe_q2.pdf' }],
  atlas: new Atlas([mkCard({ app_id: 'facturascl', display_name: 'FacturasCL', category: 'office', usage: { usage_score: 0.8, signal_sources: [] } })]),
};

// ⚑ FAKED LIVE SEAM 2: the goal→skill planner (would be Kagami/LLM over the repertoire).
const planner = (_intent: Intent): { specs: StepSpec[] } => ({
  specs: [
    { goal_id: 'g1', skill_id: 'drive.fetch.v1', inputs: { source: '/Drive/Empresa/informe_q2.pdf' }, expected_effect: 'traer el informe del Drive', reversibility: 'reversible' },
    { goal_id: 'g2', skill_id: 'billing.tally.v1', expected_effect: 'cuadrar los números con FacturasCL', reversibility: 'reversible' },
    { goal_id: 'g3', skill_id: 'fs.save.v1', expected_effect: 'guardar el resultado en el escritorio', reversibility: 'reversible' },
  ],
});

const REPERTOIRE = ['drive.fetch.v1', 'billing.tally.v1', 'fs.save.v1'];

// ⚑ FAKED LIVE SEAM 3: the skill invocations (Drive, billing, save).
const invoke: SkillInvoker = async (step) => {
  if (step.skill_id === 'drive.fetch.v1') return { success: true, output: 'informe traído', artifact: 'informe.pdf', tool: 'read_file' };
  if (step.skill_id === 'billing.tally.v1') return { success: true, output: 'números cuadrados: 12.480,00€', artifact: 'cuadre.txt', tool: 'write_file' };
  if (step.skill_id === 'fs.save.v1') return { success: true, output: 'guardado en el escritorio', tool: 'write_file' };
  return { success: false, output: 'desconocida' };
};

describe('shitsuji — T-12 EL PROMPT WOW (§16, lenguaje natural de punta a punta)', () => {
  it('hablándole como a un humano, dispara todo el pipeline y deja el rastro paso-por-paso', async () => {
    const cage = new DirCageSandbox();
    const exec = makeRealExecutor({ invoke, approved: [], ts: 't', cage });
    const deps: ServeDeps = { parse, resolvers, repertoire: REPERTOIRE, plan: planner, executor: exec, ts: 't' };

    const r = await serve(WOW, deps);
    await exec.close();

    expect(r.outcome).toBe('executed');
    // "cógeme … de mi Drive" → comprender + resolver referencias
    expect(r.intent.references.find((x) => x.phrase.includes('Drive'))!.resolved_to).toBe('/Drive/Empresa/informe_q2.pdf');
    expect(r.intent.references.find((x) => x.phrase.includes('facturación'))!.resolved_to).toBe('facturascl');
    // "pásalo por … guárdalo" → plan cross-app de 3 pasos
    expect(r.plan!.steps).toHaveLength(3);
    // "no me digas que está hecho si no lo está" → verificación honesta
    expect(r.result!.status).toBe('completed');
    expect(r.result!.honest_summary).toMatch(/hecho/i);
    // "déjame ver qué hiciste, paso por paso" → TEV verificable
    expect(r.result!.tev!.length).toBe(3);
    expect(r.narration).toMatch(/COMPRENDER/);
    expect(r.narration).toMatch(/TRAZA \(paso por paso\)/);
    expect(r.narration).toMatch(/TEV: 3 eslabones/);
  });

  it('"si no sabes hacerlo, paras y me lo dices": una parte fuera del repertorio → DECLINA, no toca nada', async () => {
    // misma orden + "y de paso quítale las hojas a la foto del informe" (skill no certificada)
    const parseImposible = async (_u: string): Promise<NLParse> => ({
      ...(await parse(_u)),
      goals: [...(await parse(_u)).goals, { verb: 'quitar', object: 'las hojas de la foto' }],
    });
    const plannerImposible = (i: Intent) => ({
      specs: [...planner(i).specs, { goal_id: 'g4', skill_id: 'img.remove_leaves.v1', expected_effect: 'quitar las hojas a la foto', reversibility: 'reversible' as const }],
    });
    const cage = new DirCageSandbox();
    const exec = makeRealExecutor({ invoke, approved: [], ts: 't', cage });
    const r = await serve(WOW, { parse: parseImposible, resolvers, repertoire: REPERTOIRE, plan: plannerImposible, executor: exec, ts: 't' });
    await exec.close();

    expect(r.outcome).toBe('declined');
    expect(r.feasibility!.missing_skills).toEqual(['img.remove_leaves.v1']);
    expect(r.narration).toMatch(/DECLINO/);
    expect(r.result).toBeUndefined();             // no se ejecutó nada
  });

  it('ambigüedad sobre datos reales → PREGUNTA antes de tocar nada (no adivina)', async () => {
    const parseAmbiguo = async (_u: string): Promise<NLParse> => ({
      goals: [{ verb: 'abrir', object: 'el diseño' }],
      references: [{ phrase: 'mi programa de diseño', kind: 'app', category: 'design' }],
    });
    const atlasAmbiguo = new Atlas([
      mkCard({ app_id: 'figma', display_name: 'Figma', category: 'design', usage: { usage_score: 0.8, signal_sources: [] } }),
      mkCard({ app_id: 'sketch', display_name: 'Sketch', category: 'design', usage: { usage_score: 0.78, signal_sources: [] } }),
    ]);
    const r = await serve('abre mi programa de diseño', { parse: parseAmbiguo, resolvers: { atlas: atlasAmbiguo }, repertoire: REPERTOIRE, plan: planner, ts: 't' });
    expect(r.outcome).toBe('asked');
    expect(r.pending_questions[0]).toMatch(/mi programa de diseño/);
    expect(r.plan).toBeUndefined();               // ni planifica, ni toca nada
  });
});
