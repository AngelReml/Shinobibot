/**
 * kagami/calibration/calibrate.ts — the soul (dossier §9).
 *
 * Calibrated self-criticism: a verdict NEVER without external anchoring
 * (anti-complacent: kills "judge and party"), and a calibration metric that
 * penalizes under-confidence EXACTLY as much as over-confidence (anti-insecure).
 * The goal is not prudence — it's EXACTNESS. An agent exact about itself doesn't
 * waste boldness on what it can't (no crash) nor repress it on what it can (no
 * cowardice). Pure, deterministic.
 */

import type { CalibrationRecord, CalibratedVerdict, SelfClaim, ExternalEvidence } from '../types.js';

export interface Prediction { declared_confidence: number; was_correct: boolean; }

/**
 * Calibration over (confidence, outcome) pairs.
 *   brier        = mean((confidence - outcome)^2)        — lower is better
 *   overconfidence  = mean(max(0, confidence - outcome)) — over-claiming (recklessness)
 *   underconfidence = mean(max(0, outcome - confidence)) — under-claiming (cowardice)
 * Both biases are reported and weighed symmetrically.
 */
export function calibrate(predictions: Prediction[], scope: CalibrationRecord['scope'] = 'overall', recordId = 'calib'): CalibrationRecord {
  const n = predictions.length;
  let brierSum = 0, over = 0, under = 0;
  for (const p of predictions) {
    const o = p.was_correct ? 1 : 0;
    const c = clamp01(p.declared_confidence);
    brierSum += (c - o) ** 2;
    over += Math.max(0, c - o);
    under += Math.max(0, o - c);
  }
  return {
    record_id: recordId,
    scope,
    predictions,
    brier_score: n ? brierSum / n : 0,
    overconfidence: n ? over / n : 0,
    underconfidence: n ? under / n : 0,
    computed_at: '',   // stamped by the caller (Date.* unavailable in some contexts)
  };
}

/** Symmetric bias label — neither side is privileged (§9.2). */
export function biasLabel(rec: { overconfidence: number; underconfidence: number }, threshold = 0.1): 'ok' | 'overconfident' | 'underconfident' {
  if (rec.overconfidence - rec.underconfidence > threshold) return 'overconfident';
  if (rec.underconfidence - rec.overconfidence > threshold) return 'underconfident';
  return 'ok';
}

/**
 * Produce a calibrated verdict for a self-claim. MANDATORY external anchor: with
 * no external evidence (or an empty ref), NO verdict is produced — it throws.
 * This is the anti-"judge and party" guarantee (§9.2 / R1).
 */
export function evaluate(claim: SelfClaim, evidence: ExternalEvidence | null | undefined): CalibratedVerdict {
  if (!evidence || !evidence.ref || !evidence.ref.trim()) {
    throw new Error('kagami: refusing to self-evaluate without external anchor (anchored_in is mandatory)');
  }
  const c = clamp01(claim.declared_confidence);
  const score = evidence.score ?? (evidence.supports ? 1 : 0);

  let level: CalibratedVerdict['level'];
  if (evidence.supports && score >= 0.85) level = 'DEMOSTRADO';
  else if (evidence.supports && score >= 0.5) level = 'PROBABLE';
  else if (!evidence.supports && score < 0.2) level = 'FUERA_DE_ALCANCE';
  else level = 'DUDOSO';

  // bias on THIS claim: declared confidence vs the external outcome.
  const gap = c - score;
  const bias_check: CalibratedVerdict['bias_check'] = gap > 0.2 ? 'overconfident' : gap < -0.2 ? 'underconfident' : 'ok';

  return { level, confidence: c, anchored_in: evidence.ref, bias_check };
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }
