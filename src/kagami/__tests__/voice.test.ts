import { describe, it, expect } from 'vitest';
import { buildSnapshot, healthTrend } from '../guard/guard.js';
import { buildSelfVoice, attachSelfVoice } from '../voice.js';
import { calibrate } from '../calibration/calibrate.js';
import { renderMarkdown } from '../../kagemusha/synth/render.js';
import type { CodeHealthSnapshot, Crack } from '../types.js';
import type { DawnReport } from '../../kagemusha/types.js';

function crack(severity: Crack['severity']): Crack {
  return { crack_id: `c_${severity}`, kind: 'regression', location: 'x', severity, detail: 'd', detected_at: 't' };
}
function snap(id: string, cracks: Crack[], failed = 0, coverage = 0.8): CodeHealthSnapshot {
  return buildSnapshot({ snapshot_id: id, taken_at: 't', suite: { passed: 100, failed, skipped: 0, duration_ms: 1 }, typecheck_errors: 0, lint_warnings: 0, coverage_overall: coverage, modules: [], cracks });
}

describe('K-04/K-06 — guard sweep + health trend (the fortress map)', () => {
  it('a new critical crack (or a new test failure) → trend down', () => {
    const prev = snap('1', [crack('low')]);
    const curr = snap('2', [crack('low'), crack('critical')]);
    expect(healthTrend(prev, curr)).toBe('down');
    expect(healthTrend(snap('a', [], 0), snap('b', [], 1))).toBe('down'); // a regression
  });
  it('fewer cracks / more coverage → trend up; stable → flat', () => {
    expect(healthTrend(snap('1', [crack('high')]), snap('2', []))).toBe('up');
    expect(healthTrend(snap('1', [crack('low')]), snap('2', [crack('low')]))).toBe('flat');
    expect(healthTrend(null, snap('2', []))).toBe('flat');
  });
});

describe('K-15 — the second voice in the Dawn Report', () => {
  const voice = buildSelfVoice({
    prevSnapshot: snap('1', [crack('high')]),
    snapshot: snap('2', [crack('critical')]),
    frontier: { reliable: 5, shaky: 2, beyond: 1 },
    calibration: calibrate([{ declared_confidence: 0.9, was_correct: true }, { declared_confidence: 0.1, was_correct: false }]),
    learning: { skill: 'japanese', level: 'N3-demostrado', mastery: false },
    frontierCrossedToday: 'certifiqué mi primera skill de fs.write',
  });

  it('builds a faithful self-voice (critical count, frontier, calibration bias)', () => {
    expect(voice.code_health.cracks_critical).toBe(1);
    expect(voice.frontier_summary.reliable).toBe(5);
    expect(voice.calibration.bias).toBe('ok');
    expect(voice.learning_progress?.skill).toBe('japanese');
  });

  it('attaches to the Kagemusha report and renders as a second voice', () => {
    const report: DawnReport = { report_id: 'r', mission_id: 'm', generated_at: 'now', looked_at: { channels: 1, transcripts: 2, threads: 1 }, highlights: [], discarded: [], build_suggestions: [], gaps: [], integrity: { fabrication_flags: 0, unverified_excluded: 0 } };
    attachSelfVoice(report, voice);
    expect(report.self_voice).toBeTruthy();
    const md = renderMarkdown(report);
    expect(md).toContain('Segunda voz');
    expect(md).toContain('cómo estoy por dentro');
    expect(md).toContain('japanese');
    expect(md).toContain('frontera nueva que crucé hoy');
  });
});
