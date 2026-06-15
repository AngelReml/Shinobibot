/**
 * kagami/learn/session.ts — K-10: the LearningSession over the FIVE learning ways
 * (dossier §8). Learning is verified, never asserted: every way produces practice,
 * but the only thing that moves the declared level is a passed exam against an
 * EXTERNAL anchor (recordExam) and the mastery criterion (masteryDemonstrated).
 *
 * The five ways (LearningMethod.kind):
 *   1. input_corpus        — study a corpus (read/ingest).
 *   2. generative_practice — produce attempts to practice (⚑ the model; injected).
 *   3. self_test           — quiz oneself against known items.
 *   4. external_correction — be corrected by an external grader/teacher.
 *   5. spaced_repetition   — revisit due items over time.
 * This module builds/sequences the ways and tracks the session; the live work of
 * each way (LLM practice, real corpus) is injected. Pure orchestration + honesty.
 */

import { recordExam, masteryDemonstrated, type MasteryThreshold } from './mastery.js';
import type { LearningSession, LearningMethod, ExamResult } from '../types.js';

export const FIVE_WAYS: LearningMethod['kind'][] = [
  'input_corpus', 'generative_practice', 'self_test', 'external_correction', 'spaced_repetition',
];

/** Start a session for a skill with a chosen set of ways (defaults to all five). */
export function startSession(sessionId: string, skill: string, ways: LearningMethod['kind'][] = FIVE_WAYS, detail = ''): LearningSession {
  const methods: LearningMethod[] = ways.map((kind) => ({ kind, detail: detail || `vía ${kind}` }));
  return { session_id: sessionId, skill, methods, declared_mastery: false, exams: [] };
}

/** Add a learning way to a session if not already present. */
export function addWay(session: LearningSession, kind: LearningMethod['kind'], detail = ''): LearningSession {
  if (session.methods.some((m) => m.kind === kind)) return session;
  return { ...session, methods: [...session.methods, { kind, detail: detail || `vía ${kind}` }] };
}

/** Record an exam (delegates to the anchored recordExam — external anchor mandatory). */
export function recordSessionExam(session: LearningSession, exam: ExamResult): LearningSession {
  return recordExam(session, exam);
}

/**
 * Re-assess the session's declared level against external truth. Sets
 * declared_mastery ONLY if the mastery criterion is met; otherwise keeps it honest.
 * current_level is set from the caller (e.g. "N3-demostrado") only when mastered.
 */
export function assessSession(session: LearningSession, threshold: MasteryThreshold, levelIfMastered?: string): LearningSession {
  const mastered = masteryDemonstrated(session, threshold);
  return {
    ...session,
    declared_mastery: mastered,
    current_level: mastered ? (levelIfMastered ?? session.current_level) : session.current_level,
  };
}

/** Which of the five ways this session is actually exercising (coverage of §8). */
export function waysCovered(session: LearningSession): { covered: LearningMethod['kind'][]; missing: LearningMethod['kind'][] } {
  const have = new Set(session.methods.map((m) => m.kind));
  return { covered: FIVE_WAYS.filter((w) => have.has(w)), missing: FIVE_WAYS.filter((w) => !have.has(w)) };
}
