/**
 * shugyo/types.ts — data model (dossier §6). Pure types.
 *
 * Grade by via: CLI/COM = strong (deterministic), UIA = medium (fragile), canvas =
 * experimental (◆). The repertoire says what it trusts and what it doesn't.
 */

import type { Origin } from '../integrity/provenance.js';

export interface Provenance { origin: Origin; channel: string; retrieved_at: string; trust_tier: 0 | 1 | 2 | 3; session_seq: number; }

export type Via = 'cli' | 'com' | 'uia' | 'canvas';
export type Grade = 'strong' | 'medium' | 'experimental';
export type Reversibility = 'reversible' | 'unknown' | 'destructive' | 'external_effect';

export interface ShugyoSession {
  session_id: string;
  app_id: string;             // from Chizu's Atlas
  via: Via;
  status: 'exploring' | 'modeling' | 'synthesizing' | 'certifying' | 'done' | 'aborted';
  budget: { maxActions: number; maxTokens: number; maxWallClockMs: number };
  reverts: number;            // how many times the cage was reverted
  skills_certified: string[];
  skills_discarded: string[];
}

export interface Affordance {
  affordance_id: string;
  kind: 'cli_command' | 'com_method' | 'ui_control';
  label: string;              // "--export", "SaveAs", button "Apply"
  signature?: string;
  reversibility: Reversibility;
}

export interface ActionSurface { app_id: string; via: Via; affordances: Affordance[]; }

export interface StateSnapshot { ref: string; summary: string; }

export interface ActionTrial {
  trial_id: string;
  affordance_id: string;
  args?: Record<string, unknown>;
  state_before: StateSnapshot;
  state_after: StateSnapshot;
  observed_effect: string;
  success: boolean;
  on_revertible_sandbox: true;   // invariant: always true
}

export interface ProcedureStep { affordance_id: string; args?: Record<string, unknown>; }

export interface Capability {
  capability_id: string;
  description: string;
  procedure: ProcedureStep[];
  preconditions: string[];
  success_check: string;
  effects: string[];          // declared effects
  grade: Grade;
}

export interface OperationalModel { app_id: string; capabilities: Capability[]; confidence: number; }

export interface LearnedSkill {
  skill_id: string;           // e.g. "app.export.pdf.v1"
  app_id: string;
  capability_id: string;
  manifest_ref: string;
  csv_ref?: string;
  status: 'candidate' | 'certified' | 'discarded';
  grade: Grade;
  provenance: Provenance;
}

export interface TransferablePattern {
  pattern_id: string;
  idiom: string;              // "open_file", "export", "undo", "save_as"
  cues: string[];
  prior_procedure_hints: string[];
  seen_in: string[];          // app_ids
  hit_rate: number;           // how often the prior accelerated learning
}
