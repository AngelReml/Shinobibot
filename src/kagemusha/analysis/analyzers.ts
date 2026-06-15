/**
 * kagemusha/analysis/analyzers.ts — C-06: the five analyzers (dossier §5.3). Each
 * looks at the corpus from one ANGLE and emits AnalysisFindings, with provenance
 * AGENT_DERIVED and a trust tier inherited from the WEAKEST evidence transcript (a
 * finding is never more trusted than its sources). These are deterministic heuristic
 * cores — testable on fixtures, no LLM; an LLM-powered analyzer can wrap the same
 * Analyzer interface. Nothing is invented: every finding cites the transcripts it
 * came from (evidence_transcript_ids).
 */

import type { Transcript, AnalysisFinding, AnalysisAngle, Provenance, TrustTier } from '../types.js';

export interface Analyzer {
  angle: AnalysisAngle;
  analyze(transcripts: Transcript[]): AnalysisFinding[];
}

let _seq = 0;
export function resetAnalyzerSeq(): void { _seq = 0; }
function fid(angle: string): string { return `find_${angle}_${++_seq}`; }

const STOP = new Set('the a an of to and or in on for is are be this that with as at by from it its we you they i de la el los las y o en un una que con para por se su lo al'.split(' '));
function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-záéíóúñ][a-záéíóúñ0-9_-]{2,}/gi) ?? []).filter((w) => !STOP.has(w));
}

/** Finding trust = the weakest (min) trust tier among its evidence transcripts. */
function derivedProvenance(evidence: Transcript[]): Provenance {
  const tier = (evidence.length ? Math.min(...evidence.map((t) => t.provenance.trust_tier)) : 1) as TrustTier;
  return { origin: 'AGENT_DERIVED', channel: 'kagemusha_analysis', retrieved_at: '', trust_tier: tier, session_seq: 0 };
}

// 1. TOPIC — the dominant terms across the corpus.
export const topicAnalyzer: Analyzer = {
  angle: 'topic',
  analyze(ts) {
    const freq = new Map<string, Set<string>>();
    for (const t of ts) for (const w of new Set(terms(t.text))) {
      (freq.get(w) ?? freq.set(w, new Set()).get(w)!).add(t.transcript_id);
    }
    const ranked = [...freq.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 5);
    return ranked.filter(([, ids]) => ids.size >= 1).map(([term, ids]) => {
      const ev = ts.filter((t) => ids.has(t.transcript_id));
      return { finding_id: fid('topic'), angle: 'topic', summary: `tema dominante: "${term}" (${ids.size} fuente/s)`, evidence_transcript_ids: [...ids], provenance: derivedProvenance(ev) } as AnalysisFinding;
    });
  },
};

// 2. RECURRENCE — terms appearing across MULTIPLE transcripts (signal, not noise).
export const recurrenceAnalyzer: Analyzer = {
  angle: 'recurrence',
  analyze(ts) {
    const freq = new Map<string, Set<string>>();
    for (const t of ts) for (const w of new Set(terms(t.text))) (freq.get(w) ?? freq.set(w, new Set()).get(w)!).add(t.transcript_id);
    return [...freq.entries()].filter(([, ids]) => ids.size >= 2).map(([term, ids]) => {
      const ev = ts.filter((t) => ids.has(t.transcript_id));
      return { finding_id: fid('recurrence'), angle: 'recurrence', summary: `recurrente en ${ids.size} fuentes: "${term}"`, evidence_transcript_ids: [...ids], provenance: derivedProvenance(ev) } as AnalysisFinding;
    });
  },
};

// 3. TEMPORAL — years/versions mentioned, to order the timeline.
export const temporalAnalyzer: Analyzer = {
  angle: 'temporal',
  analyze(ts) {
    const out: AnalysisFinding[] = [];
    for (const t of ts) {
      const marks = [...new Set((t.text.match(/\b(20\d{2}|v\d+(\.\d+)*)\b/gi) ?? []))];
      if (marks.length) out.push({ finding_id: fid('temporal'), angle: 'temporal', summary: `marcas temporales en "${t.title}": ${marks.join(', ')}`, evidence_transcript_ids: [t.transcript_id], provenance: derivedProvenance([t]) });
    }
    return out;
  },
};

// 4. CONTRADICTION — transcripts with opposing polarity on a shared term.
const POS = /\b(funciona|works|mejor|better|sota|state.of.the.art|supera|outperforms|gana)\b/i;
const NEG = /\b(no funciona|fails|peor|worse|sobrevalorad|overhyped|no supera|decepciona)\b/i;
export const contradictionAnalyzer: Analyzer = {
  angle: 'contradiction',
  analyze(ts) {
    const pos = ts.filter((t) => POS.test(t.text));
    const neg = ts.filter((t) => NEG.test(t.text));
    if (!pos.length || !neg.length) return [];
    const ev = [...new Set([...pos, ...neg])];
    return [{ finding_id: fid('contradiction'), angle: 'contradiction', summary: `contradicción: ${pos.length} fuente/s a favor vs ${neg.length} en contra`, evidence_transcript_ids: ev.map((t) => t.transcript_id), provenance: derivedProvenance(ev) }];
  },
};

// 5. ENTITY — papers/repos/products by URL/arxiv/GitHub/CapCase patterns.
export const entityAnalyzer: Analyzer = {
  angle: 'entity',
  analyze(ts) {
    const out: AnalysisFinding[] = [];
    for (const t of ts) {
      const ents = new Set<string>();
      for (const m of t.text.match(/arxiv\.org\/\S+|github\.com\/[\w.-]+\/[\w.-]+|https?:\/\/\S+/gi) ?? []) ents.add(m);
      for (const m of t.text.match(/\b([A-Z][a-zA-Z0-9]+(?:-[A-Z0-9][a-zA-Z0-9]*)+|[A-Z]{2,}[a-z0-9]+)\b/g) ?? []) ents.add(m);
      if (ents.size) out.push({ finding_id: fid('entity'), angle: 'entity', summary: `entidades en "${t.title}": ${[...ents].slice(0, 8).join(', ')}`, evidence_transcript_ids: [t.transcript_id], provenance: derivedProvenance([t]) });
    }
    return out;
  },
};

export const ALL_ANALYZERS: Analyzer[] = [topicAnalyzer, recurrenceAnalyzer, temporalAnalyzer, contradictionAnalyzer, entityAnalyzer];

/** Run a set of analyzers over the corpus, collecting all findings. */
export function runAnalyzers(transcripts: Transcript[], analyzers: Analyzer[] = ALL_ANALYZERS): AnalysisFinding[] {
  return analyzers.flatMap((a) => a.analyze(transcripts));
}
