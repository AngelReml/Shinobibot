/**
 * F5 (2026-07-06) — remate P5-Nivel 1. Verifica en frío lo que el commit dice:
 *   1. P3 (el hueco de la prueba dura): expansión REAL del grafo — una semilla
 *      cuyo contenido cita otro paper produce un segundo hilo (depth 2) por
 *      arista `cites`, vía la Frontier con presupuesto y anti-ciclo.
 *   2. Los claims del camino real llevan credibilidad de la rúbrica (§8.5)
 *      sobre señales MEDIDAS (autores extraídos, artefactos presentes).
 *   3. maxWallClockMs se enforcea (antes era un knob decorativo).
 *   4. C-18: el informe se escribe SIEMPRE a reports/<mission_id>.md.
 *   5. La tool run_kagemusha existe en el registry y respeta el gate.
 * Todo offline: fetcher/reloj inyectados, cero red, cero LLM.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { KagemushaStore } from '../store/store.js';
import { runMission, resumeMission, type PhaseHandlers } from '../mission/mission.js';
import { buildRealHandlers, runKagemusha, signalsFromAnalysis } from '../trigger.js';
import { getTool } from '../../tools/tool_registry.js';
import '../../tools/kagemusha_run.js';
import type { Entity, MissionState, MissionSpec, DawnReport } from '../types.js';

const stores: KagemushaStore[] = [];
const tmps: string[] = [];
const mem = () => { const s = new KagemushaStore({ db_path: ':memory:' }); stores.push(s); return s; };
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kage_f5_')); tmps.push(d); return d; };

const ENV_BEFORE = process.env.KAGEMUSHA_ENABLED;
afterEach(() => {
  while (stores.length) { try { stores.pop()!.close(); } catch { /* ya cerrado */ } }
  while (tmps.length) { try { fs.rmSync(tmps.pop()!, { recursive: true, force: true }); } catch { /* best effort */ } }
  if (ENV_BEFORE === undefined) delete process.env.KAGEMUSHA_ENABLED;
  else process.env.KAGEMUSHA_ENABLED = ENV_BEFORE;
});

const budget = (over: Partial<MissionSpec['budget']> = {}): MissionSpec['budget'] =>
  ({ maxDepth: 2, maxThreads: 8, maxTokens: 50_000, maxWallClockMs: 60_000, minRelevance: 0.1, ...over });

const seedEntity: Entity = {
  entity_id: 'e_seed', kind: 'paper', name: 'paper semilla', raw_mentions: [],
  first_seen_at: 't', relevance_score: 0.9,
  provenance: { origin: 'AGENT_DERIVED', channel: 'arxiv', source_url: 'https://arxiv.org/abs/2401.00001', retrieved_at: 't', trust_tier: 2, session_seq: 0 },
};

/** Fetcher falso: el paper semilla cita a otro; el hijo no cita nada (el grafo se acota solo). */
const fakeFetcher = async (url: string) => {
  if (url.includes('2401.00001')) {
    return {
      ok: true,
      text: 'Authors: Alice Smith, Bob Jones. The method achieves 73.4% accuracy on benchmark Z. ' +
        'Prior work at arxiv.org/abs/2402.00002 shows the baseline. Code: https://github.com/lab/repo.',
    };
  }
  if (url.includes('2402.00002')) {
    return { ok: true, text: 'Authors: Carol White. This baseline improves recall over classic methods.' };
  }
  return { ok: false, text: '', error: 'url desconocida en el fake' };
};

function pausedStateWithSeed(missionId: string): MissionState {
  return {
    mission_id: missionId, phase: 'PAUSED',
    spec: { channels: [], budget: budget(), models: { bulk: '', judge: '' } },
    frontier: [{ candidate: seedEntity, parentDepth: 0, priorScore: 0.9 }],
    visited: [], threadsOpened: 0, tokensSpent: 0, startedAt: 't', updatedAt: 't', gaps: [],
  };
}

describe('kagemusha — F5 remate (frontera real, wall-clock, sink, tool)', () => {
  it('P3: la semilla se investiga, su cita se expande a un segundo hilo (depth 2, arista cites), y los claims llevan credibilidad medida', async () => {
    const s = mem();
    s.saveMissionState(pausedStateWithSeed('m_p3'));
    const handlers = buildRealHandlers(s, { channels: [], outDir: tmp(), fetcher: fakeFetcher });

    const r = await resumeMission('m_p3', s, handlers, 't2');

    expect(r.state.phase).toBe('DONE');
    const nodes = s.listNodes().filter((n) => n.acquired);
    expect(nodes.length).toBe(2);                                   // semilla + segundo hilo
    const depths = nodes.map((n) => n.depth).sort();
    expect(depths).toEqual([1, 2]);                                 // expansión real, no lineal

    const edges = s.listEdges();
    expect(edges.some((e) => e.relation === 'cites')).toBe(true);   // arista padre → cita

    // Credibilidad de rúbrica sobre señales medidas: arxiv (tier 2) + autores + artefactos → admisible.
    const claims = s.listClaims();
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.every((c) => c.credibility !== undefined)).toBe(true);
    expect(r.report!.highlights.some((h) => h.text.includes('73.4%'))).toBe(true);

    // Anti-ciclo/presupuesto: nada por encima de maxDepth, sin nodos repetidos.
    expect(nodes.every((n) => n.depth <= 2)).toBe(true);
    expect(new Set(nodes.map((n) => n.node_id)).size).toBe(nodes.length);
  });

  it('la poda respeta maxDepth: con maxDepth=1 la cita NO se expande y no es un hueco, es el freno', async () => {
    const s = mem();
    const st = pausedStateWithSeed('m_depth1');
    st.spec.budget = budget({ maxDepth: 1 });
    s.saveMissionState(st);
    const handlers = buildRealHandlers(s, { channels: [], outDir: tmp(), fetcher: fakeFetcher });

    const r = await resumeMission('m_depth1', s, handlers, 't2');

    expect(r.state.phase).toBe('DONE');
    expect(s.listNodes().filter((n) => n.acquired).length).toBe(1); // solo la semilla
  });

  it('maxWallClockMs se enforcea: el loop de hilos corta con hueco honesto y el contraste se omite', async () => {
    const s = mem();
    let clock = 0;
    const now = () => (clock += 6_000);            // cada consulta avanza 6s
    let threadCalls = 0;
    const stub: PhaseHandlers = {
      async ingest() { return { transcripts: 0, channels: 0, tokens: 0 }; },
      async analyze() { return { seeds: 3, tokens: 0 }; },
      async thread() { threadCalls++; return { moreSeeds: true, investigated: 1, tokens: 0 }; },
      async contrast() { throw new Error('el contraste no debería correr con el tiempo agotado'); },
      async synthesize(state, looked_at, gaps): Promise<DawnReport> {
        return {
          report_id: 'r', mission_id: state.mission_id, generated_at: 't', looked_at,
          highlights: [], discarded: [], build_suggestions: [], gaps,
          integrity: { fabrication_flags: 0, unverified_excluded: 0 },
        };
      },
    };

    const r = await runMission(
      { channels: [], budget: budget({ maxWallClockMs: 10_000 }), models: { bulk: '', judge: '' } },
      s, stub, { missionId: 'm_wall', ts: 't', now },
    );

    expect(threadCalls).toBe(1);                                     // la 2ª iteración ya no entra
    expect(r.state.gaps.some((g) => /tiempo|maxWallClockMs/.test(g))).toBe(true);
    expect(r.state.gaps.some((g) => /contraste .* omitido/.test(g))).toBe(true);
    expect(r.state.phase).toBe('DONE');                              // ABORT no: informe parcial honesto
    expect(r.report).not.toBeNull();
  });

  it('C-18: runKagemusha escribe SIEMPRE reports/<mission_id>.md, fiel al render', async () => {
    process.env.KAGEMUSHA_ENABLED = '1';
    const s = mem();
    const reportsDir = tmp();
    const r = await runKagemusha({
      channels: [], outDir: tmp(), store: s, missionId: 'm_sink', ts: 't', reportsDir,
    });

    expect(r.reportPath).toBe(path.join(reportsDir, 'm_sink.md'));
    const md = fs.readFileSync(r.reportPath!, 'utf-8');
    expect(md).toContain('Informe del Amanecer');
    expect(md).toContain('Sello de integridad');
  });

  it('la tool run_kagemusha está registrada y respeta el gate KAGEMUSHA_ENABLED', async () => {
    const tool = getTool('run_kagemusha');
    expect(tool).toBeDefined();
    expect(tool!.requiresConfirmation?.({})).toBe(true);             // D-017 decide, nunca silencioso

    delete process.env.KAGEMUSHA_ENABLED;
    const res = await tool!.execute({ channels: ['@canal'] });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/KAGEMUSHA_ENABLED/);
  });

  it('signalsFromAnalysis mide, no inventa: sin autores ni artefactos en tier 1 → WEAK territory (corroboración jamás asumida)', () => {
    const node = { provenance: { trust_tier: 1 } } as any;
    const sig = signalsFromAnalysis(node, { claims: [], metrics: [], authors: [], citations: [] }, 'texto plano sin repos');
    expect(sig.corroboration_count).toBe(0);
    expect(sig.authors_traceable).toBe(false);
    expect(sig.has_artifacts).toBe(false);
    expect(sig.source_tier).toBe(1);
  });
});
