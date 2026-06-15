/**
 * chizu/usage/score.ts — usage scoring (dossier §7.2). Sift what matters from
 * noise. usage_score = normalized frequency (run_count) × recency (decays with
 * recency_days). Multi-signal: if UserAssist and Prefetch agree, confidence rises.
 * A heavily-used program WITHOUT a desktop shortcut must rank high. Pure.
 */

import type { UsageSignal } from '../types.js';

export function scoreUsage(s: Partial<UsageSignal>): number {
  const freq = s.run_count != null ? Math.min(s.run_count / 50, 1) : 0;
  const recency = s.recency_days != null ? Math.max(0, 1 - s.recency_days / 180) : (s.last_used ? 0.5 : 0);
  // weight frequency a bit more than recency; a tool used 200× last month beats
  // one opened once yesterday.
  let score = 0.6 * freq + 0.4 * recency;
  // multi-signal corroboration bonus (capped)
  const corroboration = (s.signal_sources?.length ?? 0) >= 2 ? 0.05 : 0;
  return Math.max(0, Math.min(1, score + corroboration));
}

/** Rank AppCard-like objects by usage_score, descending. */
export function rankByUsage<T extends { usage: { usage_score: number } }>(apps: T[]): T[] {
  return [...apps].sort((a, b) => b.usage.usage_score - a.usage.usage_score);
}
