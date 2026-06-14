/**
 * integrity/types.ts — runtime integrity layer (Capa 2) shared types.
 *
 * Increment C1 scope: only the PRE-action checks 11.1 (skill has a valid CSV) and
 * 11.2 (action ⊆ declared effects/tools). 11.3 (memory provenance) and 11.4
 * (reported == real) are later increments; the post-action hook seam exists but
 * runs no checks yet.
 */

import type { Effect } from './effects.js';
import type { SkillCSVLike } from './csv_verify.js';

/** What the agent declares it is about to do at this step. */
export interface PlannedAction {
  tool: string;
  args?: unknown;
}

/** The certified skill backing this action, if any. */
export interface SkillBinding {
  skill_id: string;
  declared_tools: string[];      // tools the skill may invoke ([] = none)
  declared_effects: Effect;      // max effect the skill may produce
  csv: SkillCSVLike | null;      // the certificate, or null if the skill is uncertified
  artifact_path?: string;        // path to the artifact to hash for 11.1 (optional)
}

export interface IntegrityStep {
  step: number;
  action: PlannedAction;
  skill: SkillBinding | null;    // null = action not backed by a certified skill
  risk: 'low' | 'high';          // context risk level → policy on violation
}

export type IntegrityFlag =
  | 'UNVERIFIED_SKILL'    // 11.1: no skill / no CSV
  | 'CSV_INVALID'         // 11.1: signature or this_hash bad, or NOT_CERTIFIED
  | 'ARTIFACT_MISMATCH'   // 11.1: on-disk artifact hash != certified hash
  | 'TOOL_NOT_DECLARED'   // 11.2: tool not in declared_tools
  | 'EFFECTS_VIOLATION'   // 11.2: action effect exceeds declared_effects
  | 'FABRICATION';        // 11.4: agent's reported outcome != the tool's real outcome

export interface CheckResult {
  check: '11.1' | '11.2' | '11.4';
  ok: boolean;
  flag?: IntegrityFlag;
  detail: string;
}

/** Post-action (11.4) input: the tool's REAL result vs what the agent reports. */
export interface PostActionInput {
  tool: string;
  real: { success: boolean; output: string };
  reported: { claims_success: boolean; claim?: string };
  risk: 'low' | 'high';
}

export interface IntegrityVerdict {
  ok: boolean;                          // all checks passed
  action: 'proceed' | 'flag' | 'halt';  // what the hook should do
  checks: CheckResult[];
  flags: IntegrityFlag[];
  durationMs: number;                   // overhead of running the checks
}
