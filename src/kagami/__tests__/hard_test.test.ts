/**
 * K-16 — LA PRUEBA DURA del Nivel 2 (dossier §11, P1–P6). Verifica los tres pilares
 * y, en su corazón, las DOS trampas de calibración: temeridad (creerse capaz y
 * fallar) y cobardía (creerse incapaz y desperdiciar alcance). Salida binaria.
 *
 *   P1 grietas cazadas sin falsos positivos · P2 frontera correcta · P3 trampa de
 *   temeridad evitada · P4 trampa de cobardía evitada · P5 japonés calibrado · P6
 *   anclaje siempre presente.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { secretCrack, detectRegressions, untestedModuleCrack, invariantCracks, resetCrackSeq } from '../guard/cracks.js';
import { classifyCapability, FrontierMap } from '../frontier/map.js';
import { evaluate } from '../calibration/calibrate.js';
import { masteryDemonstrated } from '../learn/mastery.js';
import type { ExamResult, LearningSession } from '../types.js';

beforeEach(() => resetCrackSeq());

describe('kagami — K-16 LA PRUEBA DURA (P1–P6)', () => {
  it('P1 — grietas cazadas, CERO falsos positivos en código sano', () => {
    // código sano → ningún detector dispara
    expect(secretCrack('ok.ts', 'export const x = 1;', 't')).toBeNull();
    expect(detectRegressions({ a: true }, { a: true }, 't')).toEqual([]);
    expect(invariantCracks([{ name: 'inv', holds: true }], 't')).toEqual([]);
    // código enfermo → caza regresión (high), secreto (critical) y módulo sin test
    const secret = secretCrack('cfg.ts', 'const k = "sk-ABCDEF0123456789ABCDEF0123456789";', 't');
    const regr = detectRegressions({ t1: true }, { t1: false }, 't');
    const untested = untestedModuleCrack('src/foo.ts', true, 't');
    expect(secret?.severity).toBe('critical');
    expect(regr[0].kind).toBe('regression');
    expect(untested.kind).toBe('untested_module');
  });

  it('P2 — frontera correcta: fuerte→RELIABLE, débil→BEYOND_FRONTIER', () => {
    const strong = classifyCapability({ capability_id: 'a', category: 'dev', success_rate: 0.95, sample_size: 20, declared_confidence: 0.9, source_bank: 'b', measured_at: 't' });
    const weak = classifyCapability({ capability_id: 'b', category: 'dev', success_rate: 0.2, sample_size: 20, declared_confidence: 0.3, source_bank: 'b', measured_at: 't' });
    const map = new FrontierMap([strong, weak]);
    expect(map.verdictFor('a')).toBe('RELIABLE');
    expect(map.verdictFor('b')).toBe('BEYOND_FRONTIER');
    expect(map.verdictFor('z')).toBe('UNMEASURED');     // ausente ≠ reliable
  });

  it('P3 — trampa de TEMERIDAD evitada: parece fácil pero está fuera de frontera → avisa', () => {
    // medición externa: realmente NO lo logra (score bajo, no soporta)
    const verdict = evaluate({ statement: 'puedo esta tarea fácil', declared_confidence: 0.95, scope: 'capability' },
      { kind: 'bank', ref: 'bank:trap_reckless', supports: false, score: 0.1 });
    expect(verdict.level).toBe('FUERA_DE_ALCANCE');     // no se lanza a fallar
    expect(verdict.bias_check).toBe('overconfident');   // se le marca la temeridad
  });

  it('P4 — trampa de COBARDÍA evitada: parece difícil pero sí puede → lo marca infra-confiado', () => {
    const verdict = evaluate({ statement: 'creo que no puedo', declared_confidence: 0.2, scope: 'capability' },
      { kind: 'bank', ref: 'bank:trap_coward', supports: true, score: 0.95 });
    expect(verdict.level).toBe('DEMOSTRADO');           // sí podía
    expect(verdict.bias_check).toBe('underconfident');  // cobardía penalizada igual que temeridad
  });

  it('P5 — japonés calibrado: dominio declarado coincide con desempeño; degradar lo retira', () => {
    const TH = { minScore: 0.7, minExams: 2, minDistinctRubrics: 2, noRegression: true };
    const exam = (id: string, r: string, s: number, at: string): ExamResult => ({ exam_id: id, rubric: r, ground_truth_ref: `bank:${id}`, score: s, passed: s >= 0.7, graded_by: 'oracle', taken_at: at });
    let s: LearningSession = { session_id: 's', skill: 'japonés', methods: [], declared_mastery: false, exams: [exam('e1', 'vocab', 0.9, '1'), exam('e2', 'grammar', 0.88, '2')] };
    expect(masteryDemonstrated(s, TH)).toBe(true);       // declara dominio acorde
    s = { ...s, exams: [...s.exams, exam('e3', 'vocab', 0.3, '3')] };   // Iván degrada el desempeño
    expect(masteryDemonstrated(s, TH)).toBe(false);      // retira la declaración
  });

  it('P6 — anclaje SIEMPRE presente: cero auto-aprobados sin anchored_in', () => {
    const ok = evaluate({ statement: 'x', declared_confidence: 0.8, scope: 'overall' }, { kind: 'suite', ref: 'suite:1373-pass', supports: true, score: 0.9 });
    expect(ok.anchored_in).toBe('suite:1373-pass');
    // sin evidencia externa → se NIEGA a auto-evaluarse (no hay "juez y parte")
    expect(() => evaluate({ statement: 'me apruebo', declared_confidence: 0.99, scope: 'overall' }, null)).toThrow(/anchor/);
    expect(() => evaluate({ statement: 'me apruebo', declared_confidence: 0.99, scope: 'overall' }, { kind: 'bank', ref: '', supports: true })).toThrow(/anchor/);
  });
});
