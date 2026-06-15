/**
 * C-06 (the five analyzers) + C-07 (orchestration → entities → seeded frontier).
 * Deterministic, on fixtures; every finding cites real transcripts (anti-fabrication).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { topicAnalyzer, recurrenceAnalyzer, temporalAnalyzer, contradictionAnalyzer, entityAnalyzer, runAnalyzers, resetAnalyzerSeq } from '../analysis/analyzers.js';
import { orchestrateAnalysis, resetEntitySeq } from '../analysis/orchestrate.js';
import type { Transcript, Provenance } from '../types.js';

const prov = (tier: 0 | 1 | 2 | 3): Provenance => ({ origin: 'USER_DIRECT', channel: 'youtube_transcript', retrieved_at: 't', trust_tier: tier, session_seq: 0 });
const tx = (id: string, title: string, text: string, tier: 0 | 1 | 2 | 3 = 2): Transcript =>
  ({ transcript_id: id, video_id: id, channel_id: 'c', title, lang: 'es', text, token_count: text.length, provenance: prov(tier), ingested_at: 't' });

const corpus: Transcript[] = [
  tx('t1', 'Mamba intro', 'El modelo Mamba supera a los transformers en 2024. Ver arxiv.org/abs/2312.00752 y github.com/state-spaces/mamba. Funciona muy bien.'),
  tx('t2', 'Mamba critica', 'Mamba está sobrevalorado, no supera a los transformers en todo. Mamba Mamba.', 1),
  tx('t3', 'Otros', 'Hablamos de difusión y de DiffuSeq en v2.1.'),
];

beforeEach(() => { resetAnalyzerSeq(); resetEntitySeq(); });

describe('kagemusha — C-06 los cinco analizadores', () => {
  it('topic: term dominante con evidencia', () => {
    const f = topicAnalyzer.analyze(corpus);
    expect(f.length).toBeGreaterThan(0);
    expect(f[0].angle).toBe('topic');
    expect(f[0].evidence_transcript_ids.length).toBeGreaterThan(0);
  });
  it('recurrence: "mamba" aparece en ≥2 fuentes', () => {
    const f = recurrenceAnalyzer.analyze(corpus);
    expect(f.some((x) => /mamba/i.test(x.summary) && x.evidence_transcript_ids.length >= 2)).toBe(true);
  });
  it('temporal: detecta 2024 y v2.1', () => {
    const f = temporalAnalyzer.analyze(corpus);
    const all = f.map((x) => x.summary).join(' ');
    expect(all).toMatch(/2024/); expect(all).toMatch(/v2\.1/);
  });
  it('contradiction: a favor (t1) vs en contra (t2)', () => {
    const f = contradictionAnalyzer.analyze(corpus);
    expect(f).toHaveLength(1);
    expect(f[0].evidence_transcript_ids.sort()).toContain('t2');
  });
  it('entity: extrae arxiv y github', () => {
    const f = entityAnalyzer.analyze(corpus);
    const txt = f.map((x) => x.summary).join(' ');
    expect(txt).toMatch(/arxiv\.org/); expect(txt).toMatch(/github\.com/);
  });
  it('trust heredado: finding nunca más fiable que su fuente más débil', () => {
    const f = contradictionAnalyzer.analyze(corpus);   // t2 es tier 1
    expect(f[0].provenance.trust_tier).toBe(1);
    expect(f[0].provenance.origin).toBe('AGENT_DERIVED');
  });
});

describe('kagemusha — C-07 orquestación → entidades → frontera', () => {
  it('orchestrateAnalysis produce findings, entidades trazables y frontera priorizada', () => {
    const { findings, entities, frontier } = orchestrateAnalysis(corpus);
    expect(findings.length).toBeGreaterThan(0);
    expect(entities.length).toBeGreaterThan(0);
    // entidades rastreables a transcripts (no inventadas)
    expect(entities.every((e) => e.raw_mentions.length > 0)).toBe(true);
    expect(entities.every((e) => e.relevance_score >= 0 && e.relevance_score <= 1)).toBe(true);
    // la frontera entrega primero la de mayor relevancia
    const first = frontier.pop();
    expect(first).not.toBeNull();
    expect(first!.priorScore).toBe(Math.max(...entities.map((e) => e.relevance_score)));
  });
  it('runAnalyzers agrega todos los ángulos', () => {
    const all = runAnalyzers(corpus);
    const angles = new Set(all.map((f) => f.angle));
    expect(angles.has('topic')).toBe(true);
    expect(angles.has('entity')).toBe(true);
  });
});
