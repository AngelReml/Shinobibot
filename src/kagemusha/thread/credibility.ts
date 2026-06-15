/**
 * kagemusha/thread/credibility.ts — the explicit credibility rubric (dossier §8.5).
 *
 * THE judgment mini-boss. Credibility is NOT an LLM impression: it is a rubric
 * over OBJECTIVE signals, and the aggregation is DETERMINISTIC. The LLM only fills
 * the signals (who are the authors? is there a repo?); it never dictates the
 * verdict. This is what stops a YouTube comment claiming "99%" from becoming a
 * line in the report — §11.3 applied to research: a tier-0 source can't found a
 * fact. UNFOUNDED never enters the report as a fact.
 */

import type { CredibilitySignals, CredibilityVerdict, CredibilityLevel, TrustTier } from '../types.js';

/** Deterministic aggregation (§8.5). No LLM in this function — by design. */
export function aggregateCredibility(s: CredibilitySignals): CredibilityVerdict {
  const graveRedFlag = s.red_flags.some((f) => /extraordinary|sin datos|only source.*comment|solo.*comentario|fabricated/i.test(f)) || s.red_flags.length > 0 && s.source_tier === 0;
  let level: CredibilityLevel;

  if (s.source_tier === 0 || graveRedFlag) {
    // tier-0 (comment/forum) or a grave red flag → cannot be a fact.
    level = 'UNFOUNDED';
  } else if (
    s.source_tier >= 2 && s.authors_traceable &&
    (s.corroboration_count >= 1 || s.has_artifacts) &&
    s.red_flags.length === 0
  ) {
    level = 'SOLID';
  } else if (
    (s.source_tier >= 2 || (s.has_artifacts && s.authors_traceable)) &&
    !hasGrave(s.red_flags)
  ) {
    level = 'PLAUSIBLE';
  } else if (s.source_tier <= 1 && s.corroboration_count === 0 && !s.has_artifacts) {
    level = 'WEAK';
  } else {
    level = 'WEAK';
  }

  return { level, score: scoreFor(level, s), signals: s };
}

function hasGrave(flags: string[]): boolean {
  return flags.some((f) => /extraordinary|sin datos|fabricated|retracted|plagiari/i.test(f));
}

function scoreFor(level: CredibilityLevel, s: CredibilitySignals): number {
  // A bounded, monotone score for ranking — derived from the same signals, not invented.
  const base = { SOLID: 0.85, PLAUSIBLE: 0.6, WEAK: 0.35, UNFOUNDED: 0.1 }[level];
  const tierBonus = s.source_tier * 0.03;
  const corrobBonus = Math.min(s.corroboration_count, 3) * 0.02;
  const artifactBonus = s.has_artifacts ? 0.03 : 0;
  const flagPenalty = Math.min(s.red_flags.length, 3) * 0.04;
  return Math.max(0, Math.min(1, base + tierBonus + corrobBonus + artifactBonus - flagPenalty));
}

/** A claim is admissible as a FACT in the report only if SOLID or PLAUSIBLE. */
export function admissibleAsFact(v: CredibilityVerdict): boolean {
  return v.level === 'SOLID' || v.level === 'PLAUSIBLE';
}

/** Trust tier by source type (§8.3): arxiv/official repo = 2, blog = 1, comment/forum = 0. */
export function tierForSource(kind: 'arxiv' | 'official_repo' | 'paper' | 'doc' | 'blog' | 'aggregator' | 'comment' | 'forum' | 'web' | 'unknown'): TrustTier {
  switch (kind) {
    case 'arxiv': case 'official_repo': case 'paper': case 'doc': return 2;
    case 'blog': case 'aggregator': case 'web': return 1;
    case 'comment': case 'forum': return 0;
    default: return 0; // unknown → fail-closed non-authoritative
  }
}
