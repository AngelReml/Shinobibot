import { getUsageRecord, setSkillState, loadUsage, type SkillUsageRecord } from '../learning/skill_telemetry.js';

export interface CurationResult {
  archived: string[];
  stale: string[];
}

/**
 * SkillCurator — Garbage collector for agent-created skills.
 * If an agent-created skill has not been used or viewed within the stale threshold,
 * it is transitioned to 'stale' or 'archived' state.
 */
export class SkillCurator {
  /**
   * Run the curation process.
   * @param staleAgeMs The threshold age in milliseconds after which a skill is considered stale/inactive.
   *                  Defaults to 30 days.
   */
  public static curate(staleAgeMs: number = 30 * 24 * 60 * 60 * 1000): CurationResult {
    const usage = loadUsage();
    const result: CurationResult = { archived: [], stale: [] };
    const now = Date.now();

    for (const [name, rec] of Object.entries(usage)) {
      // Only curate skills created by the agent
      if (rec.created_by !== 'agent') continue;
      
      // Skip if already archived
      if (rec.state === 'archived') continue;

      // Pinned skills are never curated/archived
      if (rec.pinned) continue;

      // Determine age/last activity
      const lastActivityStr = rec.last_used_at || rec.last_viewed_at || rec.created_at;
      const lastActivityTime = new Date(lastActivityStr).getTime();
      const ageMs = now - lastActivityTime;

      if (ageMs > staleAgeMs) {
        if (rec.state === 'active') {
          // Transition to stale first, or archive directly if we want strict GC
          // Let's transition to stale, and if it's already stale and still unused, archive it.
          setSkillState(name, 'stale');
          rec.state = 'stale'; // update in-memory reference
          result.stale.push(name);
        } else if (rec.state === 'stale') {
          // Transition stale to archived
          setSkillState(name, 'archived');
          rec.state = 'archived'; // update in-memory reference
          result.archived.push(name);
        }
      }
    }

    return result;
  }
}
