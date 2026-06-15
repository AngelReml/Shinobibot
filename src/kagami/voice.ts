/**
 * kagami/voice.ts — the second voice of the Dawn Report (dossier §10). Kagami
 * doesn't need its own report; it ENRICHES Kagemusha's. At dawn the report has two
 * voices: "what I found out there" (Kagemusha) + "how I am inside, and what
 * frontier I crossed today" (Kagami). Pure.
 */

import type { CodeHealthSnapshot, CalibrationRecord } from './types.js';
import type { DawnReport, DawnReportSelfVoice } from '../kagemusha/types.js';
import { biasLabel } from './calibration/calibrate.js';
import { healthTrend } from './guard/guard.js';

export interface SelfVoiceInputs {
  prevSnapshot: CodeHealthSnapshot | null;
  snapshot: CodeHealthSnapshot;
  frontier: { reliable: number; shaky: number; beyond: number };
  calibration: CalibrationRecord;
  learning?: { skill: string; level: string; mastery: boolean };
  frontierCrossedToday?: string;
}

export function buildSelfVoice(inp: SelfVoiceInputs): DawnReportSelfVoice {
  const critical = inp.snapshot.cracks.filter((c) => c.severity === 'critical').length;
  return {
    code_health: { cracks_critical: critical, cracks_total: inp.snapshot.cracks.length, trend: healthTrend(inp.prevSnapshot, inp.snapshot) },
    frontier_summary: inp.frontier,
    learning_progress: inp.learning,
    calibration: { brier_score: inp.calibration.brier_score, bias: biasLabel(inp.calibration) },
    frontier_crossed_today: inp.frontierCrossedToday,
  };
}

/** Attach Kagami's voice to a Kagemusha report (extends, doesn't rewrite). */
export function attachSelfVoice(report: DawnReport, voice: DawnReportSelfVoice): DawnReport {
  report.self_voice = voice;
  return report;
}
