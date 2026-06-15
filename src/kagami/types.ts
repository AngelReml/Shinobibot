/**
 * kagami/types.ts — data model (dossier §5). Pure types.
 *
 * The mirror neither flatters nor diminishes: every self-evaluation anchors in
 * EXTERNAL truth, and the reigning metric is calibration (declared confidence ==
 * real success rate), penalizing over- and under-confidence symmetrically.
 */

// ─── §5.1 Code health (Pillar A) ────────────────────────────────────────────
export type CrackKind =
  | 'untested_module' | 'uncovered_path' | 'tracked_secret'
  | 'vulnerable_dep' | 'regression' | 'broken_invariant';
export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface Crack {
  crack_id: string;
  kind: CrackKind;
  location: string;
  severity: Severity;
  detail: string;
  detected_at: string;
}

export interface ModuleHealth {
  path: string;
  coverage?: number;
  complexity?: number;
  last_break?: string;
  has_tests: boolean;
}

export interface CodeHealthSnapshot {
  snapshot_id: string;
  taken_at: string;
  suite: { passed: number; failed: number; skipped: number; duration_ms: number };
  typecheck_errors: number;
  lint_warnings: number;
  coverage_overall?: number;
  modules: ModuleHealth[];
  cracks: Crack[];
}

// ─── §5.2 Frontier map (Pillar B) ───────────────────────────────────────────
export type FrontierVerdict = 'RELIABLE' | 'SHAKY' | 'BEYOND_FRONTIER';

export interface CapabilityCell {
  capability_id: string;        // e.g. "web_research.L2"
  category: string;
  success_rate: number;         // measured against an oracle bank
  sample_size: number;
  declared_confidence: number;  // what Shinobi believes it can do (0..1)
  calibration_gap: number;      // |declared_confidence - success_rate|
  measured_at: string;
  source_bank: string;
  verdict: FrontierVerdict;
}

// ─── §5.3 Learning sessions (Pillar C) ──────────────────────────────────────
export interface LearningMethod {
  kind: 'input_corpus' | 'generative_practice' | 'self_test' | 'external_correction' | 'spaced_repetition';
  detail: string;
}

export type GradedBy = 'oracle' | 'external_judge' | 'sello_grader';

export interface ExamResult {
  exam_id: string;
  rubric: string;
  ground_truth_ref: string;     // EXTERNAL ANCHOR — mandatory
  score: number;
  passed: boolean;
  graded_by: GradedBy;
  taken_at: string;
}

export interface LearningSession {
  session_id: string;
  skill: string;                // "japanese"
  methods: LearningMethod[];
  current_level?: string;       // e.g. "N3-demostrado"
  declared_mastery: boolean;
  exams: ExamResult[];
}

// ─── §5.4 Calibration (the soul) ────────────────────────────────────────────
export interface CalibrationRecord {
  record_id: string;
  scope: 'code' | 'capability' | 'learning' | 'overall';
  predictions: { declared_confidence: number; was_correct: boolean }[];
  brier_score: number;          // lower = better
  overconfidence: number;       // bias toward over-estimating (recklessness)
  underconfidence: number;      // bias toward under-estimating (cowardice)
  computed_at: string;
}

export interface SelfClaim { statement: string; declared_confidence: number; scope: CalibrationRecord['scope']; }
export interface ExternalEvidence { kind: GradedBy | 'bank' | 'suite'; ref: string; supports: boolean; score?: number; }

export interface CalibratedVerdict {
  level: 'DEMOSTRADO' | 'PROBABLE' | 'DUDOSO' | 'FUERA_DE_ALCANCE';
  confidence: number;
  anchored_in: string;          // the external truth backing it — MANDATORY
  bias_check: 'ok' | 'overconfident' | 'underconfident';
}

// ─── §10 Second voice in the Dawn Report ────────────────────────────────────
export interface DawnReportSelfVoice {
  code_health: { cracks_critical: number; cracks_total: number; trend: 'up' | 'flat' | 'down' };
  frontier_summary: { reliable: number; shaky: number; beyond: number };
  learning_progress?: { skill: string; level: string; mastery: boolean };
  calibration: { brier_score: number; bias: 'ok' | 'overconfident' | 'underconfident' };
  frontier_crossed_today?: string;
}
