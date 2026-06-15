/**
 * kangeiko/consolidate.ts — the learning loop (dossier §2.1 CONSOLIDA, KG-04).
 * The repertoire must GROW WITHOUT becoming a dump (vertedero): keep ONE active
 * skill per capability (the best), archive the superseded, drop the discarded.
 * Self-improvement is more capability covered, not more files piled up. Pure.
 */

import type { Grade } from '../shugyo/types.js';

export interface RepertoireEntry {
  skill_id: string;
  capability_id: string;
  grade: Grade;
  version: number;
  certified_at: string;          // ISO; later wins on a tie
  status: 'active' | 'archived' | 'discarded';
}

const GRADE_RANK: Record<Grade, number> = { strong: 3, medium: 2, experimental: 1 };

/** Better = higher grade, then higher version, then more recent. */
function better(a: RepertoireEntry, b: RepertoireEntry): RepertoireEntry {
  if (GRADE_RANK[a.grade] !== GRADE_RANK[b.grade]) return GRADE_RANK[a.grade] > GRADE_RANK[b.grade] ? a : b;
  if (a.version !== b.version) return a.version > b.version ? a : b;
  return a.certified_at >= b.certified_at ? a : b;
}

export interface ConsolidationResult {
  active: RepertoireEntry[];     // one per capability — the best
  archived: RepertoireEntry[];   // superseded (kept for history, not counted as live)
  dropped: RepertoireEntry[];    // discarded — never counted
}

/**
 * Consolidate a repertoire: discarded out; per capability keep the best ACTIVE and
 * archive the rest. Adding a better version of a capability archives the old one —
 * the active set stays = distinct covered capabilities, never a pile of duplicates.
 */
export function consolidateRepertoire(entries: RepertoireEntry[]): ConsolidationResult {
  const dropped = entries.filter((e) => e.status === 'discarded');
  const candidates = entries.filter((e) => e.status !== 'discarded');

  const bestByCap = new Map<string, RepertoireEntry>();
  for (const e of candidates) {
    const cur = bestByCap.get(e.capability_id);
    bestByCap.set(e.capability_id, cur ? better(cur, e) : e);
  }
  const winners = new Set([...bestByCap.values()].map((e) => e.skill_id));

  const active: RepertoireEntry[] = [];
  const archived: RepertoireEntry[] = [];
  for (const e of candidates) {
    if (winners.has(e.skill_id)) active.push({ ...e, status: 'active' });
    else archived.push({ ...e, status: 'archived' });
  }
  return { active, archived, dropped };
}

/** Is the repertoire a dump? (more than one ACTIVE skill for some capability). */
export function isDump(active: RepertoireEntry[]): boolean {
  const seen = new Set<string>();
  for (const e of active) { if (seen.has(e.capability_id)) return true; seen.add(e.capability_id); }
  return false;
}
