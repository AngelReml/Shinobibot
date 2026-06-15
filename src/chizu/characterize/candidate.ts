/**
 * chizu/characterize/candidate.ts — automation_candidate_score (dossier §8.5).
 * Orders which apps are the juicy targets for Level 4 (Shugyo): high usage +
 * automatable (CLI/COM > UIA-rich) + easy to sandbox + low risk. Pure.
 */

import type { AppCard } from '../types.js';

export function automationCandidateScore(card: AppCard): number {
  const usage = card.usage.usage_score;

  let automatable = 0;
  if (card.characterization.cli.available === true || card.characterization.com_automation === true) automatable = 1;
  else if (card.characterization.uia.class === 'rich') automatable = 0.6;
  else if (card.characterization.uia.class === 'poor') automatable = 0.3;
  else automatable = 0; // opaque / unprobed

  const sandboxEasy = card.characterization.sandbox.verdict === 'easy' ? 1 : card.characterization.sandbox.verdict === 'hard' ? 0.4 : 0.2;

  const riskLow = card.risk.level === 'safe' ? 1 : card.risk.level === 'caution' ? 0.6 : 0; // dangerous/forbidden → 0 (excluded)

  const score = 0.4 * usage + 0.3 * automatable + 0.15 * sandboxEasy + 0.15 * riskLow;
  return Math.max(0, Math.min(1, score));
}
