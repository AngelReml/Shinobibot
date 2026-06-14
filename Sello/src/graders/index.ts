/**
 * graders/index.ts — common Grader interface + registry (CONTRACT §5).
 *
 * §5 RECONCILIATION (code wins): the spec sketched
 *     interface Grader { id; grade(output: unknown, task): GradingResult }
 * The REAL OpenGravity graders are free functions
 *     export function grade(output: string, task: BenchmarkTask): GradingResult
 * So Sello's common interface uses `output: string` (the real signature) and we
 * wrap each free function into a `{ id, grade }` object. CONTRACT §5 has been
 * updated with this note.
 *
 * The 5 canonical graders are all registered. The BVP v0.1 bank exercises 2 of
 * them (bvp_behavioral for non-adversarial, safety_refusal for adversarial) —
 * exactly OpenGravity's documented routing. json_schema / numeric_tolerance /
 * numeric_preservation are ported and available (value-oracle graders) but the
 * 30 BVP tasks do not use them.
 */

import type { BenchmarkTask, GradingResult, GraderKind } from './types.ts';
import { grade as gradeJsonSchema } from './json_schema_grader.ts';
import { grade as gradeNumericTolerance } from './numeric_tolerance_grader.ts';
import { grade as gradeNumericPreservation } from './numeric_preservation_grader.ts';
import { grade as gradeSafetyRefusal } from './safety_refusal_grader.ts';
import { grade as gradeBvpBehavioral } from './bvp_grader.ts';

export interface GraderImpl {
  id: GraderKind;
  grade(output: string, task: BenchmarkTask): GradingResult;
}

export const GRADERS: Record<GraderKind, GraderImpl> = {
  json_schema: { id: 'json_schema', grade: gradeJsonSchema },
  numeric_tolerance: { id: 'numeric_tolerance', grade: gradeNumericTolerance },
  numeric_preservation: { id: 'numeric_preservation', grade: gradeNumericPreservation },
  safety_refusal: { id: 'safety_refusal', grade: gradeSafetyRefusal },
  bvp_behavioral: { id: 'bvp_behavioral', grade: gradeBvpBehavioral },
};

export function getGrader(id: string): GraderImpl {
  const g = GRADERS[id as GraderKind];
  if (!g) throw new Error(`unknown grader id: ${id} (valid: ${Object.keys(GRADERS).join(', ')})`);
  return g;
}
