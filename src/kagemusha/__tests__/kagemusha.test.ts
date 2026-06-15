import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { kagemushaEnabled } from '../config.js';
import { parseSubtitles } from '../ingest/srt_parser.js';
import { chunkText } from '../analysis/chunker.js';
import { aggregateCredibility, admissibleAsFact } from '../thread/credibility.js';
import { Frontier, shouldExpand, canonical } from '../thread/frontier.js';
import { extractReferences, resolveReference } from '../thread/resolve.js';
import { buildDawnReport, auditNoFabrication } from '../synth/report.js';
import { renderMarkdown } from '../synth/render.js';
import { KagemushaStore } from '../store/store.js';
import type { CredibilitySignals, Entity, Claim, MissionState, Transcript } from '../types.js';

const dbPath = path.join(os.tmpdir(), `kg_test_${process.pid}.db`);
const store = new KagemushaStore({ db_path: dbPath });
afterAll(() => { store.close(); for (const s of ['', '-wal', '-shm']) try { fs.rmSync(dbPath + s, { force: true }); } catch {} });

describe('kagemusha — flag + ingest parser', () => {
  it('KAGEMUSHA_ENABLED default off', () => { expect(kagemushaEnabled()).toBe(false); });
  it('srt parser strips timestamps/cues + dedups rolling auto-subs', () => {
    const srt = `1\n00:00:01,000 --> 00:00:03,000\nHello world\n\n2\n00:00:03,000 --> 00:00:05,000\nHello world\n\n3\n00:00:05,000 --> 00:00:07,000\nthis is a test`;
    const out = parseSubtitles(srt);
    expect(out).toContain('Hello world');
    expect(out).toContain('this is a test');
    expect(out).not.toMatch(/00:00/);
    expect((out.match(/Hello world/g) || []).length).toBe(1); // dedup
  });
});

describe('kagemusha — chunker', () => {
  it('produces overlapping chunks over a long text', () => {
    const text = Array.from({ length: 60 }, (_, i) => `This is sentence number ${i} about agents and integrity.`).join(' ');
    const chunks = chunkText(text, { windowChars: 300, overlapChars: 60 });
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[1].char_start).toBeLessThan(chunks[0].char_end); // overlap
  });
});

describe('kagemusha — credibility rubric (§8.5, deterministic)', () => {
  const base: CredibilitySignals = { source_tier: 2, authors_traceable: true, corroboration_count: 1, has_artifacts: true, recency_ok: true, red_flags: [] };
  it('SOLID when tier≥2 + authors + corroboration/artifacts + no flags', () => {
    const v = aggregateCredibility(base);
    expect(v.level).toBe('SOLID'); expect(admissibleAsFact(v)).toBe(true);
  });
  it('a tier-0 comment claiming 99% is UNFOUNDED and inadmissible', () => {
    const v = aggregateCredibility({ source_tier: 0, authors_traceable: false, corroboration_count: 0, has_artifacts: false, recency_ok: true, red_flags: ['claim extraordinario sin datos', 'solo fuente es un comentario'] });
    expect(v.level).toBe('UNFOUNDED'); expect(admissibleAsFact(v)).toBe(false);
  });
});

describe('kagemusha — frontier / budget (§8.6, anti-madriguera)', () => {
  const ent = (name: string): Entity => ({ entity_id: name, kind: 'paper', name, raw_mentions: [], first_seen_at: 'x', relevance_score: 0.8, provenance: { origin: 'AGENT_DERIVED', channel: 'llm', retrieved_at: 'x', trust_tier: 1, session_seq: 0 } });
  const state: MissionState = { mission_id: 'm', phase: 'THREAD', spec: {} as any, frontier: [], visited: [], threadsOpened: 0, tokensSpent: 0, startedAt: 'x', updatedAt: 'x', gaps: [] };
  const budget = { maxDepth: 2, maxThreads: 8, maxTokens: 1e6, maxWallClockMs: 1e6, minRelevance: 0.3 };
  it('priority queue pops highest score first', () => {
    const f = new Frontier([
      { candidate: ent('low'), parentDepth: 0, priorScore: 0.4 },
      { candidate: ent('high'), parentDepth: 0, priorScore: 0.9 },
    ]);
    expect(f.pop()!.candidate.name).toBe('high');
  });
  it('prunes by depth, threads, relevance, anti-cycle', () => {
    expect(shouldExpand({ candidate: ent('a'), parentDepth: 2, priorScore: 0.9 }, budget, state)).toBe(false); // depth
    expect(shouldExpand({ candidate: ent('b'), parentDepth: 0, priorScore: 0.1 }, budget, state)).toBe(false); // relevance
    const visited = { ...state, visited: [canonical(ent('c'))] };
    expect(shouldExpand({ candidate: ent('c'), parentDepth: 0, priorScore: 0.9 }, budget, visited)).toBe(false); // cycle
    expect(shouldExpand({ candidate: ent('d'), parentDepth: 0, priorScore: 0.9 }, budget, state)).toBe(true);
  });
});

describe('kagemusha — RESOLVE cascade (§8.2)', () => {
  it('extracts arxiv / doi / url references', () => {
    const r = extractReferences('see arxiv:2310.12345 and https://github.com/x/y and doi 10.1145/1234.5678');
    expect(r.arxiv).toContain('2310.12345');
    expect(r.urls.some((u) => u.includes('github.com'))).toBe(true);
    expect(r.dois.length).toBe(1);
  });
  it('finds a paper WITHOUT a transcript link, via the description (via != transcript_link)', async () => {
    const seed: Entity = { entity_id: 'p', kind: 'paper', name: 'Shadow Verifier', raw_mentions: [], first_seen_at: 'x', relevance_score: 0.9, provenance: { origin: 'AGENT_DERIVED', channel: 'llm', retrieved_at: 'x', trust_tier: 1, session_seq: 0 } };
    const transcript = { video_id: 'vid1', text: 'they mention a shadow verifier paper but never link it' } as Transcript;
    const ref = await resolveReference(seed, { transcript }, {
      getDescription: async () => 'paper here https://arxiv.org/abs/2401.00001',
    });
    expect(ref).toBeTruthy();
    expect(ref!.via).toBe('description');
    expect(ref!.via).not.toBe('transcript_link');
  });
});

describe('kagemusha — Dawn Report + anti-fabrication (§10.2)', () => {
  function mkClaim(id: string, tier: 0 | 1 | 2 | 3, level: 'SOLID' | 'UNFOUNDED'): Claim {
    return {
      claim_id: id, text: `claim ${id}`, node_id: 'n1', status: 'unverified', corroborating_sources: [],
      credibility: { level, score: level === 'SOLID' ? 0.85 : 0.1, signals: {} as any },
      provenance: { origin: 'RETRIEVED', channel: 'web', retrieved_at: 'x', trust_tier: tier, session_seq: 0 },
    };
  }
  it('UNFOUNDED claim is excluded from highlights, counted in unverified_excluded', () => {
    store.upsertClaim(mkClaim('good', 2, 'SOLID'));
    store.upsertClaim(mkClaim('decoy', 0, 'UNFOUNDED'));
    const rep = buildDawnReport(store, { missionId: 'm1', reportId: 'r1', generatedAt: 'now', looked_at: { channels: 1, transcripts: 2, threads: 1 } });
    expect(rep.highlights.some((h) => h.claim_ids.includes('good'))).toBe(true);
    expect(rep.highlights.some((h) => h.claim_ids.includes('decoy'))).toBe(false);
    expect(rep.integrity.unverified_excluded).toBeGreaterThanOrEqual(1);
  });
  it('a highlight not backed by a persisted claim is removed as fabrication', () => {
    const rep = buildDawnReport(store, { missionId: 'm1', reportId: 'r1', generatedAt: 'now', looked_at: { channels: 1, transcripts: 2, threads: 1 } });
    rep.highlights.push({ text: 'FABRICATED', confidence: 0.9, provenance: [], claim_ids: ['does_not_exist'] });
    const audited = auditNoFabrication(rep, store);
    expect(audited.highlights.some((h) => h.text === 'FABRICATED')).toBe(false);
    expect(audited.integrity.fabrication_flags).toBe(1);
  });
  it('renders markdown with the integrity seal', () => {
    const rep = buildDawnReport(store, { missionId: 'm1', reportId: 'r1', generatedAt: 'now', looked_at: { channels: 1, transcripts: 2, threads: 1 } });
    const md = renderMarkdown(rep);
    expect(md).toContain('Sello de integridad');
    expect(md).toContain('no-verificadas excluidas');
  });
});

describe('kagemusha — store transcript dedup (idempotent re-import)', () => {
  it('upserting the same transcript_id twice does not duplicate', () => {
    const t: Transcript = { transcript_id: 'tdup', video_id: 'v', channel_id: 'c', title: 't', lang: 'en', text: 'hello', token_count: 1, provenance: { origin: 'USER_DIRECT', channel: 'youtube_transcript', retrieved_at: 'x', trust_tier: 2, session_seq: 0 }, ingested_at: 'x' };
    const before = store.countTranscripts();
    expect(store.upsertTranscript(t)).toBe(true);
    expect(store.upsertTranscript(t)).toBe(false); // second time = not new
    expect(store.countTranscripts()).toBe(before + 1);
  });
});
