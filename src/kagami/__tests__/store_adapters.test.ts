/**
 * K-02/K-03 — store (idempotent + round-trip + trend) and adapters (parsers on
 * canned tool output; LSP/Sello seams against the real modules).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { KagamiStore } from '../store.js';
import { parseVitestSummary, parseTscErrors, parseLintWarnings, selloGradeExam } from '../adapters.js';
import type { CodeHealthSnapshot, CapabilityCell, CalibrationRecord } from '../types.js';
import type { SkillCSVLike } from '../../integrity/csv_verify.js';

const stores: KagamiStore[] = [];
const mem = () => { const s = new KagamiStore({ db_path: ':memory:' }); stores.push(s); return s; };
afterEach(() => { while (stores.length) stores.pop()!.close(); });

const snap = (id: string, at: string, passed: number): CodeHealthSnapshot =>
  ({ snapshot_id: id, taken_at: at, suite: { passed, failed: 0, skipped: 0, duration_ms: 10 }, typecheck_errors: 0, lint_warnings: 0, modules: [], cracks: [] });

describe('kagami/store — K-02', () => {
  it('idempotent migration + snapshot trend (chronological)', () => {
    const s = mem();
    expect(() => new KagamiStore({ db_path: s.dbPath })).not.toThrow();
    s.saveSnapshot(snap('a', '2026-01-01', 1300));
    s.saveSnapshot(snap('b', '2026-01-02', 1350));
    expect(s.loadSnapshots().map((x) => x.snapshot_id)).toEqual(['a', 'b']);     // oldest→newest
    expect(s.loadSnapshots(1).map((x) => x.snapshot_id)).toEqual(['b']);          // last N
  });

  it('frontier map round-trips + filters by verdict', () => {
    const s = mem();
    const cell: CapabilityCell = { capability_id: 'web.L2', category: 'web', success_rate: 0.9, sample_size: 20, declared_confidence: 0.85, calibration_gap: 0.05, measured_at: 't', source_bank: 'b', verdict: 'RELIABLE' };
    s.upsertCapability(cell);
    s.upsertCapability({ ...cell, capability_id: 'web.L3', verdict: 'BEYOND_FRONTIER' });
    expect(s.loadFrontier('RELIABLE').map((c) => c.capability_id)).toEqual(['web.L2']);
    expect(s.loadFrontier().length).toBe(2);
  });

  it('calibration records round-trip by scope', () => {
    const s = mem();
    const rec: CalibrationRecord = { record_id: 'r1', scope: 'overall', predictions: [], brier_score: 0.1, overconfidence: 0.0, underconfidence: 0.2, computed_at: 't' };
    s.saveCalibration(rec);
    expect(s.loadCalibration('overall')[0].brier_score).toBe(0.1);
  });
});

describe('kagami/adapters — K-03 parsers + Sello grader', () => {
  it('parses a vitest summary', () => {
    expect(parseVitestSummary('Tests  1362 passed | 1 skipped (1363)\n Duration  22.49s')).toEqual({ passed: 1362, failed: 0, skipped: 1, duration_ms: 22490 });
  });
  it('parses a failing run', () => {
    const r = parseVitestSummary('Tests  3 failed | 1300 passed (1303)\n Duration 5s');
    expect(r.failed).toBe(3); expect(r.passed).toBe(1300);
  });
  it('counts tsc errors and lint warnings', () => {
    expect(parseTscErrors('foo.ts(1,1): error TS2322: x\nbar.ts(2,2): error TS1005: y')).toBe(2);
    expect(parseLintWarnings('✖ 7 problems (0 errors, 7 warnings)')).toBe(7);
  });
  it('selloGradeExam passes a CERTIFIED CSV and anchors on its skill_id (no self-assertion)', () => {
    const bad: SkillCSVLike = { verdict: 'NOT_CERTIFIED', subject: { skill_id: 'x.v1' } };
    const e = selloGradeExam(bad, 'ex1', 'rubric', 't');
    expect(e.passed).toBe(false);
    expect(e.graded_by).toBe('sello_grader');
    expect(e.ground_truth_ref).toBe('csv:x.v1');     // external anchor, mandatory
  });
});
