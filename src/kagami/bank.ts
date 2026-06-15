/**
 * kagami/bank.ts — K-07 (load oracle banks + graders) and K-08 (run a capability
 * against a bank with a DECLARED confidence → a measured CapabilityCell). The
 * frontier is measured, never presumed: every case carries an EXTERNAL expected
 * answer (the ground truth), the solver is the capability under test (injected ⚑),
 * and the verdict comes from the success rate + calibration gap (classifyCapability).
 *
 * Graders are reusable; the Sello grader seam lives in adapters.ts (selloGradeExam).
 */

import { classifyCapability } from './frontier/map.js';
import type { CapabilityCell } from './types.js';

export interface BankCase { case_id: string; input: string; expected: string; }
export interface OracleBank { bank_id: string; capability_id: string; category: string; cases: BankCase[]; }

/** Parse + validate a bank. Every case MUST carry an external `expected` (anchor). */
export function loadBank(raw: unknown): OracleBank {
  const b = raw as Partial<OracleBank>;
  if (!b || typeof b.bank_id !== 'string' || typeof b.capability_id !== 'string' || !Array.isArray(b.cases)) {
    throw new Error('bank inválido: faltan bank_id/capability_id/cases');
  }
  for (const c of b.cases) {
    if (typeof c?.expected !== 'string' || c.expected.length === 0) throw new Error(`caso ${c?.case_id ?? '?'} sin ground truth (expected)`);
  }
  return { bank_id: b.bank_id, capability_id: b.capability_id, category: b.category ?? 'other', cases: b.cases as BankCase[] };
}

export type Grader = (output: string, expected: string) => boolean;
export const exactGrader: Grader = (o, e) => o.trim() === e.trim();
export const substringGrader: Grader = (o, e) => o.includes(e.trim());

/** ⚑ the capability under test (live): input → its answer. Injected so the run is testable. */
export type Solver = (input: string) => Promise<string>;

export interface BankRun {
  bank_id: string;
  results: { case_id: string; output: string; passed: boolean }[];
  passed: number;
  total: number;
  success_rate: number;
}

/** Run every case through the solver, grade against the external expected. */
export async function runBank(bank: OracleBank, solver: Solver, grader: Grader = exactGrader): Promise<BankRun> {
  const results: BankRun['results'] = [];
  for (const c of bank.cases) {
    let output = '';
    try { output = await solver(c.input); } catch (e: any) { output = `__error__: ${e?.message ?? e}`; }
    results.push({ case_id: c.case_id, output, passed: grader(output, c.expected) });
  }
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  return { bank_id: bank.bank_id, results, passed, total, success_rate: total ? passed / total : 0 };
}

/**
 * K-08: measure a capability from a bank run + the DECLARED confidence → a
 * CapabilityCell with a verdict (RELIABLE/SHAKY/BEYOND_FRONTIER). The declared
 * confidence is what Shinobi believed BEFORE the run; the gap to the real success
 * rate is the calibration signal (recklessness vs cowardice).
 */
export function measureFromBank(bank: OracleBank, run: BankRun, declaredConfidence: number, measuredAt: string): CapabilityCell {
  return classifyCapability({
    capability_id: bank.capability_id, category: bank.category,
    success_rate: run.success_rate, sample_size: run.total,
    declared_confidence: declaredConfidence, source_bank: bank.bank_id, measured_at: measuredAt,
  });
}
