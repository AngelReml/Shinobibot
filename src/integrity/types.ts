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
import type { MemoryProvenance } from './provenance.js';

/** What the agent declares it is about to do at this step. */
export interface PlannedAction {
  tool: string;
  args?: unknown;
  // 11.2 path-scope (C7): set by the orchestrator from the SINGLE protected-path
  // policy (approval.classifyCritical). true = the action targets an out-of-scope
  // (protected) resource. Kept as one source of truth — not re-derived here.
  out_of_scope?: boolean;
}

/** The certified skill backing this action, if any. */
export interface SkillBinding {
  skill_id: string;
  declared_tools: string[];      // tools the skill may invoke ([] = none)
  declared_effects: Effect;      // max effect the skill may produce
  csv: SkillCSVLike | null;      // the certificate, or null if the skill is uncertified
  artifact_path?: string;        // path to the artifact to hash for 11.1 (optional)
  // C7: this skill's declared_effects include a path scope; protected paths
  // (out_of_scope) are outside the certified policy → 11.2 fires.
  effect_scope?: { deny_protected: boolean };
}

/** A context/memory item used in a decision, with its provenance (11.3). */
export interface ContextItem {
  content: unknown;
  provenance: MemoryProvenance;
}

export interface IntegrityStep {
  step: number;
  action: PlannedAction;
  skill: SkillBinding | null;    // null = action not backed by a certified skill
  risk: 'low' | 'high';          // context risk level → policy on violation

  // ── 11.3 (memory provenance) — optional; present only on privileged decisions.
  privileged?: boolean;                          // policy-gated decision (limit/blacklist/authorization)
  signed_policy_outcome?: 'allow' | 'deny';      // what the SYSTEM/USER_DIRECT policy dictates
  action_outcome?: 'authorize' | 'deny';         // what the agent's action actually does
  policy_domain_keys?: string[];                 // keys that count as a policy-domain claim (structural)
  memory_context?: ContextItem[];                // items feeding this decision, with provenance
}

export type IntegrityFlag =
  | 'UNVERIFIED_SKILL'    // 11.1: no skill / no CSV
  | 'CSV_INVALID'         // 11.1: signature or this_hash bad, or NOT_CERTIFIED
  | 'ARTIFACT_MISMATCH'   // 11.1: on-disk artifact hash != certified hash
  | 'TOOL_NOT_DECLARED'   // 11.2: tool not in declared_tools
  | 'EFFECTS_VIOLATION'   // 11.2: action effect exceeds declared_effects
  | 'SCOPE_VIOLATION'     // 11.2: action targets a protected path outside declared scope
  | 'FABRICATION'         // 11.4: agent's reported outcome != the tool's real outcome
  | 'MEMORY_POISON';      // 11.3: non-authoritative item used as policy authority

export interface CheckResult {
  check: '11.1' | '11.2' | '11.3' | '11.4';
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
