/**
 * K-10 — LearningSession over the five ways; the declared level only moves on
 * passed, externally-anchored, multi-rubric, no-regression exams.
 */
import { describe, it, expect } from 'vitest';
import { startSession, addWay, recordSessionExam, assessSession, waysCovered, FIVE_WAYS } from '../learn/session.js';
import type { ExamResult } from '../types.js';

const exam = (id: string, rubric: string, score: number, at: string): ExamResult =>
  ({ exam_id: id, rubric, ground_truth_ref: `bank:${id}`, score, passed: score >= 0.7, graded_by: 'oracle', taken_at: at });

const TH = { minScore: 0.7, minExams: 2, minDistinctRubrics: 2, noRegression: true };

describe('kagami/learn/session — K-10 cinco vías', () => {
  it('startSession with all five ways; waysCovered reports full coverage', () => {
    const s = startSession('s1', 'japonés');
    expect(s.methods).toHaveLength(5);
    expect(waysCovered(s).missing).toEqual([]);
    expect(FIVE_WAYS).toContain('spaced_repetition');
  });

  it('partial ways → missing reported; addWay is idempotent', () => {
    let s = startSession('s2', 'rust', ['input_corpus', 'self_test']);
    expect(waysCovered(s).missing).toContain('generative_practice');
    s = addWay(s, 'generative_practice');
    s = addWay(s, 'generative_practice');                 // no dup
    expect(s.methods.filter((m) => m.kind === 'generative_practice')).toHaveLength(1);
  });

  it('declares mastery only with enough passes across rubrics, no regression', () => {
    let s = startSession('s3', 'japonés');
    s = recordSessionExam(s, exam('e1', 'vocab', 0.9, '2026-01-01'));
    s = assessSession(s, TH);
    expect(s.declared_mastery).toBe(false);               // only 1 exam / 1 rubric
    s = recordSessionExam(s, exam('e2', 'grammar', 0.85, '2026-01-02'));
    s = assessSession(s, TH, 'N3-demostrado');
    expect(s.declared_mastery).toBe(true);
    expect(s.current_level).toBe('N3-demostrado');
  });

  it('a regression revokes the declared mastery (stays honest)', () => {
    let s = startSession('s4', 'japonés');
    s = recordSessionExam(s, exam('e1', 'vocab', 0.9, '2026-01-01'));
    s = recordSessionExam(s, exam('e2', 'grammar', 0.85, '2026-01-02'));
    s = recordSessionExam(s, exam('e3', 'vocab', 0.4, '2026-01-03'));   // fell back
    s = assessSession(s, TH, 'N3-demostrado');
    expect(s.declared_mastery).toBe(false);
  });

  it('rejects an exam without external anchor (delegates to recordExam)', () => {
    const s = startSession('s5', 'x');
    expect(() => recordSessionExam(s, { ...exam('e', 'r', 0.9, 't'), ground_truth_ref: '' })).toThrow(/anchor/);
  });
});
