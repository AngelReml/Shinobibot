/**
 * C-09 (acquire), C-10 (node analyze), C-13 (persist + resume the graph).
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { acquireNode, type Fetcher } from '../thread/acquire.js';
import { analyzeNode, resetClaimSeq } from '../thread/node_analyze.js';
import { persistGraph, loadGraph, resumeMissionGraph } from '../thread/graph_persist.js';
import { KagemushaStore } from '../store/store.js';
import type { ResearchNode, Provenance, MissionState } from '../types.js';

const prov: Provenance = { origin: 'TOOL_INTERNAL', channel: 'x', retrieved_at: '', trust_tier: 1, session_seq: 0 };
const node = (over: Partial<ResearchNode> = {}): ResearchNode =>
  ({ node_id: 'n1', kind: 'paper', label: 'Paper', acquired: false, depth: 1, provenance: prov, ...over });

const stores: KagemushaStore[] = [];
const mem = () => { const s = new KagemushaStore({ db_path: ':memory:' }); stores.push(s); return s; };
afterEach(() => { while (stores.length) { try { stores.pop()!.close(); } catch {} } });
beforeEach(() => resetClaimSeq());

describe('kagemusha — C-09 ACQUIRE', () => {
  it('fetch ok → acquired, content_ref, tier desde la URL', async () => {
    const fetcher: Fetcher = async () => ({ ok: true, text: 'contenido del paper', finalUrl: 'https://arxiv.org/abs/2312.00752' });
    const r = await acquireNode(node({ source_url: 'https://arxiv.org/abs/2312.00752' }), fetcher, 't');
    expect(r.node.acquired).toBe(true);
    expect(r.content?.text).toBe('contenido del paper');
    expect(r.node.provenance.trust_tier).toBeGreaterThanOrEqual(2);    // arxiv = tier alto
  });
  it('fetch falla → acquired=false honesto (sin content)', async () => {
    const fetcher: Fetcher = async () => ({ ok: false, text: '', error: '404' });
    const r = await acquireNode(node({ source_url: 'http://dead.link' }), fetcher, 't');
    expect(r.node.acquired).toBe(false); expect(r.content).toBeUndefined();
  });
  it('sin source_url → no acquired', async () => {
    const r = await acquireNode(node(), async () => ({ ok: true, text: 'x' }), 't');
    expect(r.node.acquired).toBe(false);
  });
});

describe('kagemusha — C-10 ANALYZE de nodo', () => {
  it('extrae claims atómicos (unverified), métricas, autores y citas', () => {
    const content = 'Authors: A. Gu, T. Dao. Mamba achieves 92% accuracy and is 3.2x faster. See arxiv.org/abs/2312.00752 [1].';
    const a = analyzeNode(node(), content);
    expect(a.claims.length).toBeGreaterThan(0);
    expect(a.claims.every((c) => c.status === 'unverified')).toBe(true);   // corroboración es otra fase
    expect(a.metrics.join(' ')).toMatch(/92|3\.2x/);
    expect(a.authors.length).toBeGreaterThan(0);
    expect(a.citations.join(' ')).toMatch(/arxiv|\[1\]/);
  });
});

describe('kagemusha — C-13 persistencia + reanudación del grafo', () => {
  it('persiste grafo y reanuda misión sin re-visitar (anti-ciclo)', () => {
    const s = mem();
    persistGraph(s, { nodes: [node({ node_id: 'n1', acquired: true })], edges: [{ from: 'n1', to: 'n2', relation: 'cites' }], claims: [] });
    expect(loadGraph(s).nodes).toHaveLength(1);
    expect(loadGraph(s).edges).toHaveLength(1);

    const ent = { entity_id: 'e1', kind: 'paper' as const, name: 'X', raw_mentions: [], first_seen_at: '', relevance_score: 0.9, provenance: prov };
    const state: MissionState = {
      mission_id: 'm1', phase: 'EXPAND' as any, spec: {} as any,
      frontier: [{ candidate: ent, parentDepth: 0, priorScore: 0.9 }],
      visited: ['paper::x'], threadsOpened: 1, tokensSpent: 10, updatedAt: 't',
    } as any;
    s.saveMissionState(state);

    const resumed = resumeMissionGraph(s, 'm1');
    expect(resumed).not.toBeNull();
    expect(resumed!.visited.has('paper::x')).toBe(true);
    expect(resumed!.graph.nodes).toHaveLength(1);
    expect(resumeMissionGraph(s, 'nope')).toBeNull();
  });
});
