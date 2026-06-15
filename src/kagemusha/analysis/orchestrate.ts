/**
 * kagemusha/analysis/orchestrate.ts — C-07: orchestrate the analyzers, distill the
 * entities, and seed the investigation frontier. The analyzers can run in parallel
 * (swarm injected ⚑); entity extraction + the seed queue are deterministic. Nothing
 * is invented: entities come only from analyzer findings that cite real transcripts.
 */

import { runAnalyzers, type Analyzer } from './analyzers.js';
import { Frontier } from '../thread/frontier.js';
import type { Transcript, AnalysisFinding, Entity, EntityKind, FrontierItem, Provenance } from '../types.js';

let _eseq = 0;
export function resetEntitySeq(): void { _eseq = 0; }

function entityKindOf(token: string): EntityKind {
  if (/arxiv\.org/i.test(token)) return 'paper';
  if (/github\.com/i.test(token)) return 'repo';
  if (/^https?:\/\//i.test(token)) return 'concept';
  return 'concept';
}

/**
 * Extract entities from the analysis findings. relevance_score = fraction of the
 * corpus that mentions the entity (recurrence ⇒ relevance), capped to [0,1]. Each
 * entity records its raw mentions (transcript_id + span) — traceable, not invented.
 */
export function extractEntities(findings: AnalysisFinding[], transcripts: Transcript[]): Entity[] {
  const total = Math.max(1, transcripts.length);
  const byToken = new Map<string, { ids: Set<string>; spans: { transcript_id: string; span: string }[] }>();
  for (const f of findings.filter((x) => x.angle === 'entity' || x.angle === 'recurrence')) {
    // pull quoted/comma-listed tokens out of the finding summary
    const tokens: string[] = [
      ...(f.summary.match(/arxiv\.org\/\S+|github\.com\/[\w.-]+\/[\w.-]+|https?:\/\/\S+/gi) ?? []),
      ...(f.summary.match(/"([^"]+)"/g) ?? []).map((s) => s.replace(/"/g, '')),
    ];
    for (const tk of tokens) {
      const e = byToken.get(tk) ?? byToken.set(tk, { ids: new Set(), spans: [] }).get(tk)!;
      for (const id of f.evidence_transcript_ids) { e.ids.add(id); e.spans.push({ transcript_id: id, span: f.summary.slice(0, 80) }); }
    }
  }
  const prov: Provenance = { origin: 'AGENT_DERIVED', channel: 'kagemusha_entities', retrieved_at: '', trust_tier: 2, session_seq: 0 };
  return [...byToken.entries()].map(([name, e]) => ({
    entity_id: `ent_${++_eseq}`, kind: entityKindOf(name), name,
    raw_mentions: e.spans.slice(0, 10), first_seen_at: '',
    relevance_score: Math.min(1, e.ids.size / total), provenance: prov,
  } as Entity));
}

/** Seed the investigation frontier from entities, highest-relevance first. */
export function seedFrontier(entities: Entity[]): Frontier {
  const items: FrontierItem[] = entities
    .slice().sort((a, b) => b.relevance_score - a.relevance_score)
    .map((e) => ({ candidate: e, parentDepth: 0, priorScore: e.relevance_score }));
  return new Frontier(items);
}

export interface OrchestrateResult { findings: AnalysisFinding[]; entities: Entity[]; frontier: Frontier; }

/** Run analyzers → findings → entities → seeded frontier (the analysis pipeline). */
export function orchestrateAnalysis(transcripts: Transcript[], analyzers?: Analyzer[]): OrchestrateResult {
  const findings = runAnalyzers(transcripts, analyzers);
  const entities = extractEntities(findings, transcripts);
  const frontier = seedFrontier(entities);
  return { findings, entities, frontier };
}
