/**
 * kagemusha/thread/node_analyze.ts — C-10: ANALYZE an acquired node into atomic,
 * verifiable claims + metrics + authors + citations (dossier §8, phase ANALYZE).
 * Deterministic extraction core (the LLM variant can refine the same shape); claims
 * start 'unverified' and inherit the node's provenance — corroboration is a later
 * phase, never assumed here.
 */

import type { ResearchNode, Claim, Provenance } from '../types.js';

let _cseq = 0;
export function resetClaimSeq(): void { _cseq = 0; }

export interface NodeAnalysis {
  claims: Claim[];
  metrics: string[];        // e.g. "92% accuracy", "3.2x faster"
  authors: string[];
  citations: string[];      // arxiv ids / [N] refs / urls cited
}

const ASSERT = /\b(is|are|was|were|achieves?|outperforms?|shows?|demonstrates?|reduces?|improves?|supera|logra|consigue|reduce|mejora|es|son)\b/i;

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 12);
}

/** Extract atomic claims + metrics + authors + citations from a node's content. */
export function analyzeNode(node: ResearchNode, content: string): NodeAnalysis {
  const prov: Provenance = { ...node.provenance, origin: 'AGENT_DERIVED' };
  const claims: Claim[] = sentences(content)
    .filter((s) => ASSERT.test(s) && /[A-Za-z]/.test(s))
    .slice(0, 12)
    .map((s) => ({ claim_id: `claim_${++_cseq}`, text: s, node_id: node.node_id, status: 'unverified', corroborating_sources: [], provenance: prov }));

  const metrics = [...new Set(content.match(/\b\d+(\.\d+)?\s?%|\b\d+(\.\d+)?x\b|\b\d+(\.\d+)?\s?(accuracy|FID|BLEU|ms|FPS|tokens?\/s)\b/gi) ?? [])];
  const authors = [...new Set([
    ...(content.match(/Authors?:\s*([^\n.]+)/i)?.[1]?.split(/,|;| and /).map((a) => a.trim()).filter(Boolean) ?? []),
  ])];
  const citations = [...new Set([
    ...(content.match(/arxiv\.org\/(abs|pdf)\/\d{4}\.\d{4,5}/gi) ?? []),
    ...(content.match(/\[\d+\]/g) ?? []),
  ])];

  return { claims, metrics, authors, citations };
}
