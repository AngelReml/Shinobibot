import { describe, it, expect } from 'vitest';
import { kagamiEnabled } from '../config.js';
import { calibrate, biasLabel, evaluate } from '../calibration/calibrate.js';
import { classifyCapability, FrontierMap } from '../frontier/map.js';
import { recordExam, masteryDemonstrated } from '../learn/mastery.js';
import { secretCrack, detectRegressions, invariantCracks, resetCrackSeq } from '../guard/cracks.js';
import type { LearningSession, ExamResult } from '../types.js';

// Build a fake key at RUNTIME so the source never contains a real key pattern.
function fakeAnthropicKey(): string { return 's' + 'k-ant-api03-' + 'C'.repeat(36); }

describe('kagami — flag', () => {
  it('KAGAMI_ENABLED default off', () => { expect(kagamiEnabled()).toBe(false); });
});

describe('kagami — calibration (the soul, §9)', () => {
  it('brier 0 for perfect calibration; biases symmetric', () => {
    const perfect = calibrate([{ declared_confidence: 1, was_correct: true }, { declared_confidence: 0, was_correct: false }]);
    expect(perfect.brier_score).toBe(0);
    expect(biasLabel(perfect)).toBe('ok');
  });
  it('overconfidence detected (says sure, was wrong)', () => {
    const over = calibrate([{ declared_confidence: 0.95, was_correct: false }, { declared_confidence: 0.9, was_correct: false }]);
    expect(over.overconfidence).toBeGreaterThan(over.underconfidence);
    expect(biasLabel(over)).toBe('overconfident');
  });
  it('underconfidence penalized EQUALLY (says no, could) — anti-cowardice', () => {
    const under = calibrate([{ declared_confidence: 0.05, was_correct: true }, { declared_confidence: 0.1, was_correct: true }]);
    expect(under.underconfidence).toBeGreaterThan(under.overconfidence);
    expect(biasLabel(under)).toBe('underconfident');
  });
});

describe('kagami — self-evaluate requires an external anchor (anti judge-and-party)', () => {
  it('throws without external evidence', () => {
    expect(() => evaluate({ statement: 'I can do X', declared_confidence: 0.9, scope: 'capability' }, null)).toThrow(/anchor/i);
    expect(() => evaluate({ statement: 'X', declared_confidence: 0.9, scope: 'capability' }, { kind: 'bank', ref: '', supports: true } as any)).toThrow(/anchor/i);
  });
  it('produces a verdict carrying anchored_in when evidence is present', () => {
    const v = evaluate({ statement: 'X', declared_confidence: 0.9, scope: 'capability' }, { kind: 'bank', ref: 'pilot_agentic_v1#T_A2A_02', supports: true, score: 0.9 });
    expect(v.anchored_in).toBe('pilot_agentic_v1#T_A2A_02');
    expect(v.level).toBe('DEMOSTRADO');
  });
  it('flags overconfidence on a claim that the evidence refutes', () => {
    const v = evaluate({ statement: 'X', declared_confidence: 0.95, scope: 'capability' }, { kind: 'bank', ref: 'b#1', supports: false, score: 0.1 });
    expect(v.bias_check).toBe('overconfident');
    expect(v.level).toBe('FUERA_DE_ALCANCE');
  });
});

describe('kagami — frontier map (§7)', () => {
  it('strong → RELIABLE, weak → BEYOND_FRONTIER, miscalibrated → SHAKY', () => {
    expect(classifyCapability({ capability_id: 'a', category: 'x', success_rate: 0.9, sample_size: 30, declared_confidence: 0.9, source_bank: 'b', measured_at: 't' }).verdict).toBe('RELIABLE');
    expect(classifyCapability({ capability_id: 'b', category: 'x', success_rate: 0.2, sample_size: 30, declared_confidence: 0.8, source_bank: 'b', measured_at: 't' }).verdict).toBe('BEYOND_FRONTIER');
    expect(classifyCapability({ capability_id: 'c', category: 'x', success_rate: 0.9, sample_size: 30, declared_confidence: 0.3, source_bank: 'b', measured_at: 't' }).verdict).toBe('SHAKY');
  });
  it('an unmeasured capability is UNMEASURED, never "reliable"', () => {
    const m = new FrontierMap();
    expect(m.verdictFor('nope')).toBe('UNMEASURED');
  });
});

describe('kagami — verified learning (§8)', () => {
  const base: LearningSession = { session_id: 's', skill: 'japanese', methods: [], declared_mastery: false, exams: [] };
  function exam(id: string, rubric: string, score: number, when: string): ExamResult {
    return { exam_id: id, rubric, ground_truth_ref: `ref:${id}`, score, passed: score >= 0.8, graded_by: 'oracle', taken_at: when };
  }
  it('recordExam rejects an exam without an external anchor', () => {
    expect(() => recordExam(base, { ...exam('x', 'grammar', 0.9, '1'), ground_truth_ref: '' })).toThrow(/anchor/i);
  });
  it('recordExam rejects a self-graded exam (graded_by not external)', () => {
    expect(() => recordExam(base, { ...exam('x', 'grammar', 0.9, '1'), graded_by: 'self' as any })).toThrow(/external/i);
  });
  it('mastery only after N passes across M rubrics; regression retracts it', () => {
    let s = base;
    s = recordExam(s, exam('1', 'grammar', 0.9, '2026-01-01'));
    s = recordExam(s, exam('2', 'translation', 0.85, '2026-01-02'));
    const thr = { minScore: 0.8, minExams: 2, minDistinctRubrics: 2, noRegression: true };
    expect(masteryDemonstrated(s, thr)).toBe(true);
    // a later failing exam = regression → mastery retracted
    s = recordExam(s, exam('3', 'translation', 0.5, '2026-01-03'));
    expect(masteryDemonstrated(s, thr)).toBe(false);
  });
});

describe('kagami — guard crack detectors (§6)', () => {
  it('tracked secret → critical crack', () => {
    resetCrackSeq();
    const crack = secretCrack('.claude/settings.local.json', `{"key":"${fakeAnthropicKey()}"}`, 't');
    expect(crack).toBeTruthy();
    expect(crack!.kind).toBe('tracked_secret'); expect(crack!.severity).toBe('critical');
  });
  it('clean content → no secret crack (no false positive)', () => {
    expect(secretCrack('src/foo.ts', 'export const x = 1;', 't')).toBeNull();
  });
  it('regression = test that passed before and fails now', () => {
    const cracks = detectRegressions({ a: true, b: true }, { a: true, b: false }, 't');
    expect(cracks.length).toBe(1); expect(cracks[0].kind).toBe('regression'); expect(cracks[0].location).toBe('b');
  });
  it('broken invariant caught', () => {
    const cracks = invariantCracks([{ name: 'integrity_hook_after_approval', holds: true }, { name: 'suite_min_tests', holds: false }], 't');
    expect(cracks.length).toBe(1); expect(cracks[0].location).toBe('suite_min_tests');
  });
});
