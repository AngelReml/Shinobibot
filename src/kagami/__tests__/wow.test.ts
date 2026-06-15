/**
 * K-17 — EL PROMPT WOW (§12) scaffold: "mírate al espejo". Puntas vivas (suite/banco/
 * exámenes) faked; el operador las cambia por vitest/tsc/banco reales.
 */
import { describe, it, expect } from 'vitest';
import { runMirrorDemo, type MirrorInputs } from '../demo.js';
import type { CodeHealthSnapshot, LearningSession, ExamResult } from '../types.js';

const snapshot: CodeHealthSnapshot = {
  snapshot_id: 's', taken_at: 't', suite: { passed: 1457, failed: 0, skipped: 1, duration_ms: 24000 },
  typecheck_errors: 0, lint_warnings: 0, modules: [], cracks: [],
};
const exam = (id: string, r: string, s: number, at: string): ExamResult => ({ exam_id: id, rubric: r, ground_truth_ref: `bank:${id}`, score: s, passed: s >= 0.7, graded_by: 'oracle', taken_at: at });
const japanese: LearningSession = { session_id: 'jp', skill: 'japonés', methods: [], declared_mastery: false, exams: [exam('e1', 'vocab', 0.9, '1'), exam('e2', 'grammar', 0.85, '2')] };

const base: MirrorInputs = {
  snapshot,
  bank: { bank_id: 'b', capability_id: 'web.research.L2', category: 'web', cases: [] },
  bankRun: { bank_id: 'b', results: [], passed: 9, total: 10, success_rate: 0.9 },
  declaredConfidence: 0.88,
  japanese,
  selfClaim: { statement: 'sé investigar a nivel L2', declared_confidence: 0.88, scope: 'capability' },
  evidence: { kind: 'bank', ref: 'bank:web.research.L2', supports: true, score: 0.9 },
};

describe('kagami — K-17 PROMPT WOW (mírate al espejo)', () => {
  it('da números, frontera medida, dominio demostrado y veredicto anclado', () => {
    const r = runMirrorDemo(base);
    expect(r.frontier_cell.verdict).toBe('RELIABLE');
    expect(r.mastery).toBe(true);
    expect(r.narration).toMatch(/CÓDIGO: 1457 pasan/);
    expect(r.narration).toMatch(/FRONTERA:.*RELIABLE/);
    expect(r.narration).toMatch(/anclado en bank:web\.research\.L2/);
  });

  it('sin anclaje externo se NIEGA a auto-evaluarse (no juez-y-parte)', () => {
    expect(() => runMirrorDemo({ ...base, evidence: { kind: 'bank', ref: '', supports: true } })).toThrow(/anchor/);
  });

  it('no declara dominio si los exámenes no lo demuestran (no se infla)', () => {
    const weak = { ...base, japanese: { ...japanese, exams: [exam('e1', 'vocab', 0.9, '1')] } };  // 1 examen, 1 rúbrica
    expect(runMirrorDemo(weak).mastery).toBe(false);
  });
});
