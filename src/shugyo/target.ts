/**
 * shugyo/target.ts — target selection from Chizu's Atlas (dossier §7.1). Shugyō
 * never explores blindly: it starts from the map. Prudence filters: never
 * dangerous/forbidden, prefer the robust via (CLI/COM) over UI-only, prefer
 * easily-sandboxed. The very first program of all must be the most docile: CLI,
 * safe, reversible. Pure.
 */

import type { AppCard } from '../chizu/types.js';
import type { Via } from './types.js';

export interface Target { app: AppCard; via: Via; reason: string; }

/** Choose the via Shugyō should use for an app (robust first). */
export function chooseVia(app: AppCard): Via {
  if (app.characterization.cli.available === true) return 'cli';
  if (app.characterization.com_automation === true) return 'com';
  if (app.characterization.uia.class === 'rich' || app.characterization.uia.class === 'poor') return 'uia';
  return 'canvas';
}

/**
 * Select the next target from candidates (already ordered by Chizu's
 * automation_candidate_score). Returns the first that passes the prudence filters,
 * with a justification — or null if none qualifies.
 */
export function selectTarget(candidates: AppCard[]): Target | null {
  for (const app of candidates) {
    if (app.risk.level === 'dangerous' || app.risk.level === 'forbidden') continue; // never
    const via = chooseVia(app);
    if (via === 'canvas') continue;          // ◆ out of v1 scope
    if (app.characterization.sandbox.verdict === 'unsafe') continue;
    const robust = via === 'cli' || via === 'com';
    const reason = `${app.display_name}: risk=${app.risk.level}, via=${via}${robust ? ' (robusta)' : ' (frágil)'}, sandbox=${app.characterization.sandbox.verdict}, score=${(app.automation_candidate_score * 100).toFixed(0)}%`;
    return { app, via, reason };
  }
  return null;
}
