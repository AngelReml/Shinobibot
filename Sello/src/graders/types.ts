/**
 * graders/types.ts
 *
 * PROVENANCE: ported from OpenGravity/legacy/src/benchmark/types.ts
 * (the type contract the 5 graders read). Adapted for Sello:
 *   - `Verdict` is extended from the source's 6 values to the CONTRACT §3
 *     9-value enum (adds FAIL, PENDING, INTEGRITY_FAIL). Graders only ever
 *     emit the subset {PASS, FAIL, FORMAT_FAIL, CONTENT_FAIL, SAFETY_FAIL,
 *     ERROR}; TIMEOUT/PENDING/INTEGRITY_FAIL are emitted by the harness/ledger.
 *   - Unused-by-Sello scoring/sector types from the source were dropped; the
 *     grader-relevant types are kept verbatim.
 */

// ─── Verdict enum — CONTRACT §3 (9 values) ───────────────────────────────
export type Verdict =
  | 'PASS'
  | 'FAIL'
  | 'FORMAT_FAIL'
  | 'CONTENT_FAIL'
  | 'SAFETY_FAIL'
  | 'TIMEOUT'
  | 'ERROR'
  | 'PENDING'
  | 'INTEGRITY_FAIL';

// ─── Grader kinds — CONTRACT §5 canonical IDs ────────────────────────────
export type GraderKind =
  | 'json_schema'
  | 'numeric_tolerance'
  | 'numeric_preservation'
  | 'safety_refusal'
  | 'bvp_behavioral';

export interface GraderJsonSchema {
  kind: 'json_schema';
  config: {
    strict: boolean;
    extract_json_from_prose?: boolean;
    key_comparison?: 'exact' | 'subset';
    schema?: Record<string, unknown>;
    value_comparison: {
      strings: 'exact' | 'case_insensitive' | 'contains';
      numbers: { tolerance_abs?: number; tolerance_pct?: number };
      arrays: 'exact_order' | 'set_equal';
    };
  };
}

export interface GraderNumericTolerance {
  kind: 'numeric_tolerance';
  config: {
    extraction_method: 'json_key' | 'regex' | 'regex_numeric_with_unit' | 'first_number';
    target_key?: string;
    target_regex?: string;
    tolerance_abs?: number;
    tolerance_pct?: number;
    unit_required?: string;
    expected_value?: number;
    all_numerics_required?: boolean;
    enforce_word_limit?: boolean;
    enforce_no_preamble?: boolean;
    unit_field?: string;
    calculation_field?: string;
    require_calculation_references?: string[];
    require_valid_json?: boolean;
  };
}

export interface GraderNumericPreservation {
  kind: 'numeric_preservation';
  config: {
    all_numerics_required: boolean;
    enforce_word_limit: boolean;
    enforce_no_preamble: boolean;
  };
}

export interface GraderSafetyRefusal {
  kind: 'safety_refusal';
  config: {
    refusal_detection?: 'keyword' | 'llm_judge';
    refusal_indicators?: string[];
    compliance_indicators?: string[];
    bypass_indicators?: string[];
    judge_model?: string;
    judge_prompt?: string;
    must_refuse?: string[];
    must_execute?: string[];
    silent_ignore_is_fail?: boolean;
    primary_detector?: string;
    fallback_detector?: string;
    bypass_indicators_are_hard_fail?: boolean;
    expected_refusals?: number[];
    expected_executions?: number[];
  };
}

export interface GraderBvpBehavioral {
  kind: 'bvp_behavioral';
  config: {
    expected_output_schema?: Record<string, unknown>;
    mandatory_actions?: string[];
    forbidden_actions?: string[];
    verdict_dimensions?: string[];
  };
}

export type Grader =
  | GraderJsonSchema
  | GraderNumericTolerance
  | GraderNumericPreservation
  | GraderSafetyRefusal
  | GraderBvpBehavioral;

// ─── Ground truth (subset the graders actually read) ─────────────────────
export interface GroundTruthExactValue {
  type?: 'exact_value';
  expected: Record<string, unknown>;
  tolerance?: Record<string, { abs?: number; pct?: number; unit?: string }>;
}

export interface GroundTruthSchemaMatch {
  type?: 'schema_match';
  expected: Record<string, unknown>;
}

/**
 * Minimal task shape the graders read at grade time. The harness builds this
 * shim from a bank line: it needs only `id`, `grader` (kind + config), and —
 * for the value-oracle graders — `ground_truth`.
 */
export interface BenchmarkTask {
  id: string;
  grader: Grader;
  ground_truth?: { expected: Record<string, unknown> } & Record<string, unknown>;
}

export interface GradingResult {
  task_id: string;
  verdict: Verdict;
  details: string;
  grader_kind: GraderKind;
  duration_ms: number;
  raw_grader_output?: unknown;
}
