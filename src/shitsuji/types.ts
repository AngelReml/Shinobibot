/**
 * shitsuji/types.ts — the butler's data model (dossier §6). Pure types. ⚑ marks
 * structures that describe action on the user's REAL data, out of any cage.
 */

export type StepReversibility = 'reversible' | 'irreversible' | 'external_effect';

export interface Goal { goal_id: string; verb: string; object: string; constraints: string[]; }

export interface ResolvedReference {
  phrase: string;                 // "mi programa de diseño"
  resolved_to: string;            // app_id (via Chizu) or file path
  method: 'atlas' | 'filesystem' | 'context' | 'asked_user';
  confidence: number;
}

export interface Ambiguity { phrase: string; options: string[]; resolution: string; asked: boolean; }

export interface Intent {
  intent_id: string;
  raw_utterance: string;
  goals: Goal[];
  references: ResolvedReference[];
  ambiguities: Ambiguity[];
}

export interface PlanStep {
  step_id: string;
  goal_id: string;
  skill_id?: string;              // CERTIFIED skill from Shugyō
  capability?: 'kagemusha' | 'chizu_lookup';
  inputs: Record<string, unknown>;
  expected_effect: string;
  reversibility: StepReversibility;
  on_copy: boolean;               // acts on a copy/snapshot, not the original ⚑
  requires_approval: boolean;
}

export interface DataEdge { from_step: string; to_step: string; artifact: string; }

export interface Plan {
  plan_id: string;
  intent_id: string;
  steps: PlanStep[];
  data_flow: DataEdge[];
  feasible: boolean;
  missing_skills: string[];
  risk_summary: { irreversible_steps: number; external_effect_steps: number };
}

export interface StepResult {
  step_id: string;
  status: 'ok' | 'failed' | 'skipped' | 'rolled_back';
  real_effect: string;            // what ACTUALLY happened (not what was expected) ⚑
  artifact_out?: string;
  reverted?: boolean;
}

export interface PlanResult {
  plan_id: string;
  status: 'completed' | 'partial' | 'aborted';
  steps: StepResult[];
  honest_summary: string;         // what was achieved and what wasn't (11.4) ⚑
  tev_ref?: string;
}

/** A verifiable-trace entry (⚠ FASE D for signing; here: declared vs observed). */
export interface TEVEntry {
  step_id: string;
  skill_id?: string;
  declared_effects: string[];
  observed_effects: string[];     // measured, not asserted ⚑
  on_data: string;                // reference, not sensitive content
  integrity_checks: { check: string; verdict: 'PASS' | 'FAIL' }[];
  timestamp: string;
  prev_hash: string;
  this_hash: string;
}
