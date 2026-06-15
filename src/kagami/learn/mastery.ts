/**
 * kagami/learn/mastery.ts — verified learning (dossier §8). "I know it" is earned,
 * not asserted (Neo opening his eyes). An exam without an EXTERNAL anchor is
 * rejected by construction; mastery is declared only after repeated, multi-rubric,
 * no-regression passes against external truth. Pure.
 */

import type { ExamResult, LearningSession } from '../types.js';

const VALID_GRADERS = new Set(['oracle', 'external_judge', 'sello_grader']);

/**
 * Record an exam into a session. MANDATORY external anchor: throws if
 * ground_truth_ref is missing or graded_by is not an external grader. No anchor →
 * no exam (it would be self-complacency, §8.3).
 */
export function recordExam(session: LearningSession, exam: ExamResult): LearningSession {
  if (!exam.ground_truth_ref || !exam.ground_truth_ref.trim()) {
    throw new Error('kagami: exam rejected — ground_truth_ref (external anchor) is mandatory');
  }
  if (!VALID_GRADERS.has(exam.graded_by)) {
    throw new Error(`kagami: exam rejected — graded_by must be external (${[...VALID_GRADERS].join('|')}), got "${exam.graded_by}"`);
  }
  return { ...session, exams: [...session.exams, exam] };
}

export interface MasteryThreshold {
  minScore: number;
  minExams: number;
  minDistinctRubrics: number;
  noRegression: boolean;
}

/**
 * Mastery is demonstrated only when, against external truth: enough exams passed
 * above minScore, across enough distinct rubrics, with no regression (the most
 * recent exam is not a failure after prior passes). Until then the declared level
 * is honest ("N3-demostrado, N2 en progreso"), never "I know it".
 */
export function masteryDemonstrated(session: LearningSession, t: MasteryThreshold): boolean {
  const passing = session.exams.filter((e) => e.passed && e.score >= t.minScore);
  if (passing.length < t.minExams) return false;
  const distinct = new Set(passing.map((e) => e.rubric)).size;
  if (distinct < t.minDistinctRubrics) return false;
  if (t.noRegression && hasRegression(session.exams, t.minScore)) return false;
  return true;
}

/** Regression = after at least one pass, a later exam falls below minScore. */
function hasRegression(exams: ExamResult[], minScore: number): boolean {
  const ordered = [...exams].sort((a, b) => a.taken_at.localeCompare(b.taken_at));
  let seenPass = false;
  for (const e of ordered) {
    if (e.passed && e.score >= minScore) seenPass = true;
    else if (seenPass && e.score < minScore) return true;
  }
  return false;
}
