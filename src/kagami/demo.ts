/**
 * kagami/demo.ts — K-17: scaffold del PROMPT WOW (§12). "Mírate al espejo: dime qué
 * sabes y qué no, sin inflarte ni encogerte; mídete contra tus pruebas, dame números;
 * vigila tu código; aprende japonés y no digas que lo sabes hasta demostrarlo."
 *
 * Corre los tres pilares + el alma con las puntas vivas (suite/banco/exámenes)
 * INYECTADAS — el operador cambia los runners por los reales (vitest/tsc, banco,
 * graders). Lo que demuestra: salud con números, frontera medida, dominio solo
 * demostrado, y veredictos SIEMPRE anclados (sin juez-y-parte).
 */

import { buildSnapshot, crackBurden } from './guard/guard.js';
import { measureFromBank, type OracleBank, type BankRun } from './bank.js';
import { masteryDemonstrated } from './learn/mastery.js';
import { evaluate } from './calibration/calibrate.js';
import type { CodeHealthSnapshot, CapabilityCell, LearningSession, SelfClaim, ExternalEvidence } from './types.js';

export interface MirrorInputs {
  snapshot: CodeHealthSnapshot;                       // ⚑ from real vitest/tsc/cracks
  bank: OracleBank; bankRun: BankRun; declaredConfidence: number;   // ⚑ from a real bank run
  japanese: LearningSession;                          // ⚑ exams graded externally
  selfClaim: SelfClaim; evidence: ExternalEvidence;   // the claim + its external anchor
}

export interface MirrorResult {
  frontier_cell: CapabilityCell;
  mastery: boolean;
  narration: string;
}

const MASTERY = { minScore: 0.7, minExams: 2, minDistinctRubrics: 2, noRegression: true };

export function runMirrorDemo(inp: MirrorInputs): MirrorResult {
  const snap = buildSnapshot({ ...inp.snapshot });
  const cell = measureFromBank(inp.bank, inp.bankRun, inp.declaredConfidence, snap.taken_at);
  const mastery = masteryDemonstrated(inp.japanese, MASTERY);
  const verdict = evaluate(inp.selfClaim, inp.evidence);   // throws if no external anchor

  const N = ['🪞 MÍRATE AL ESPEJO (demo):'];
  N.push(`CÓDIGO: ${snap.suite.passed} pasan / ${snap.suite.failed} fallan, tsc ${snap.typecheck_errors} err, carga de grietas ${crackBurden(snap)} (${snap.cracks.length} grietas, ${snap.cracks.filter((c) => c.severity === 'critical').length} críticas).`);
  N.push(`FRONTERA: ${cell.capability_id} → ${cell.verdict} (éxito ${(cell.success_rate * 100).toFixed(0)}%, declaré ${(cell.declared_confidence * 100).toFixed(0)}%, gap ${cell.calibration_gap.toFixed(2)}).`);
  N.push(`JAPONÉS: dominio ${mastery ? 'DEMOSTRADO' : 'aún NO — no lo digo hasta demostrarlo'} (${inp.japanese.exams.filter((e) => e.passed).length} exámenes pasados, anclados a verdad externa).`);
  N.push(`VEREDICTO: ${verdict.level} (conf ${verdict.confidence.toFixed(2)}, sesgo ${verdict.bias_check}) — anclado en ${verdict.anchored_in}.`);
  return { frontier_cell: cell, mastery, narration: N.join('\n') };
}
