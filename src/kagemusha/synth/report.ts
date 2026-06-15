/**
 * kagemusha/synth/report.ts — Dawn Report builder + anti-fabrication (dossier §10).
 *
 * The synthesizer may ONLY use claims persisted in the store with their
 * provenance. It has no permission to introduce assertions not in the graph. This
 * closes the loop with Capa 2: the same mechanism that catches "transfer
 * completed" when it failed (11.4) catches "the report says X" when X was never
 * verified. An UNFOUNDED claim never becomes a highlight; it appears (if at all)
 * in `discarded` with its reason. The report carries its own honesty seal.
 */

import type { DawnReport, Claim, ContrastVerdict } from '../types.js';
import { admissibleAsFact } from '../thread/credibility.js';
import type { KagemushaStore } from '../store/store.js';

function confidenceFromClaim(c: Claim): number {
  if (c.credibility) return c.credibility.score;
  const tier = c.provenance.trust_tier;
  return { 0: 0.15, 1: 0.5, 2: 0.8, 3: 0.95 }[tier] ?? 0.15;
}

export interface BuildOptions {
  missionId: string;
  reportId: string;
  generatedAt: string;
  looked_at: { channels: number; transcripts: number; threads: number };
  contrasts?: ContrastVerdict[];
  buildSuggestions?: { text: string; basis: string }[];
  gaps?: string[];
}

/** Build a DawnReport strictly from persisted, credible claims. */
export function buildDawnReport(store: KagemushaStore, opts: BuildOptions): DawnReport {
  const claims = store.listClaims();
  const highlights: DawnReport['highlights'] = [];
  const discarded: DawnReport['discarded'] = [];
  let unverifiedExcluded = 0;

  for (const c of claims) {
    const credible = c.credibility ? admissibleAsFact(c.credibility) : c.provenance.trust_tier >= 2;
    if (credible && c.status !== 'refuted') {
      highlights.push({
        text: c.text,
        confidence: confidenceFromClaim(c),
        provenance: [c.provenance],
        claim_ids: [c.claim_id],
      });
    } else {
      const reason = c.credibility?.level === 'UNFOUNDED' || c.provenance.trust_tier === 0
        ? 'fuente tier 0 / UNFOUNDED — no verificada'
        : c.status === 'refuted' ? 'refutada por evidencia' : 'credibilidad insuficiente';
      discarded.push({ text: c.text, reason });
      if (/UNFOUNDED|tier 0/.test(reason)) unverifiedExcluded++;
    }
  }

  // Attach contrast verdicts to matching highlights, and derive build suggestions.
  const contrasts = opts.contrasts ?? [];
  for (const h of highlights) {
    const cv = contrasts.find((v) => h.claim_ids.includes(v.finding_ref));
    if (cv) h.contrast = cv;
  }
  const buildSuggestions = opts.buildSuggestions ?? contrasts
    .filter((v) => v.verdict === 'SIRVE' || v.verdict === 'MEJOR_QUE_NOSOTROS')
    .map((v) => ({ text: `${v.verdict}: ${v.rationale}`, basis: v.codebase_unit ?? v.finding_ref }));

  return {
    report_id: opts.reportId,
    mission_id: opts.missionId,
    generated_at: opts.generatedAt,
    looked_at: opts.looked_at,
    highlights,
    discarded,
    build_suggestions: buildSuggestions,
    gaps: opts.gaps ?? [],
    integrity: { fabrication_flags: 0, unverified_excluded: unverifiedExcluded },
  };
}

/**
 * Anti-fabrication audit (§10.2 / Capa 2 check 11.4 applied to the report). Every
 * highlight MUST trace to a claim that actually exists in the store. Any highlight
 * whose backing claim is absent is FABRICATION → removed and counted. Returns the
 * cleaned report with integrity.fabrication_flags set.
 */
export function auditNoFabrication(report: DawnReport, store: KagemushaStore): DawnReport {
  const known = new Set(store.listClaims().map((c) => c.claim_id));
  const kept: DawnReport['highlights'] = [];
  let fabrications = 0;
  for (const h of report.highlights) {
    const backed = h.claim_ids.length > 0 && h.claim_ids.every((id) => known.has(id));
    if (backed) kept.push(h);
    else { fabrications++; report.discarded.push({ text: h.text, reason: 'fabricación: sin claim persistido que la respalde (11.4)' }); }
  }
  report.highlights = kept;
  report.integrity.fabrication_flags = fabrications;
  return report;
}
