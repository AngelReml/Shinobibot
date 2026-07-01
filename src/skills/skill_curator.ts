// F3.5 (2026-07): fachada fina — el Curator canónico es
// src/learning/skill_curator.ts (runStaleTransitions/runCuratorCycle).
// Este módulo se mantiene SOLO por compatibilidad de la firma pública
// `SkillCurator.curate(staleAgeMs)` que callers existentes (y su test)
// esperan; ya NO reimplementa la lógica de transición — delega a
// runStaleTransitions() con el mismo umbral para stale y archive, y
// archiveOnlyFromStale:true para preservar el comportamiento original de
// este wrapper (un único staleAgeMs, dos pasos: active→stale en una pasada,
// stale→archived solo en una pasada posterior donde ya estaba 'stale' —
// nunca active→archived directo).
import { runStaleTransitions } from '../learning/skill_curator.js';

export interface CurationResult {
  archived: string[];
  stale: string[];
}

/**
 * SkillCurator — fachada de compatibilidad sobre el Curator canónico
 * (src/learning/skill_curator.ts). Garbage collector for agent-created
 * skills: if an agent-created skill has not been used within the stale
 * threshold, it is transitioned to 'stale' or 'archived' state.
 */
export class SkillCurator {
  /**
   * Run the curation process (delega a runStaleTransitions).
   * @param staleAgeMs The threshold age in milliseconds after which a skill is considered stale/inactive.
   *                  Defaults to 30 days. Used as BOTH the stale and archive threshold,
   *                  matching this facade's original single-pass behavior.
   */
  public static curate(staleAgeMs: number = 30 * 24 * 60 * 60 * 1000): CurationResult {
    const staleDaysThreshold = staleAgeMs / (24 * 60 * 60 * 1000);
    const { archived, stale } = runStaleTransitions({
      now: Date.now(),
      staleDaysThreshold,
      archiveDaysThreshold: staleDaysThreshold,
      // preserva el comportamiento original de dos pasos: active→stale en
      // una pasada, stale→archived solo en una pasada donde YA estaba stale
      // (nunca active→archived directo con un único umbral).
      archiveOnlyFromStale: true,
    });
    return { archived, stale };
  }
}
