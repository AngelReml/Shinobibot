/**
 * K-07/K-08 — oracle bank loading + graders, and the measured run → CapabilityCell.
 * The frontier is MEASURED: every case has an external expected; the verdict comes
 * from success_rate + the gap to the declared confidence (recklessness/cowardice).
 */
import { describe, it, expect } from 'vitest';
import { loadBank, runBank, measureFromBank, exactGrader } from '../bank.js';

const BANK = {
  bank_id: 'arith.b1', capability_id: 'arith.add.L1', category: 'dev',
  cases: [
    { case_id: 'c1', input: '2+2', expected: '4' },
    { case_id: 'c2', input: '10+5', expected: '15' },
    { case_id: 'c3', input: '7+1', expected: '8' },
    { case_id: 'c4', input: '100+1', expected: '101' },
  ],
};

describe('kagami/bank — K-07 carga + graders', () => {
  it('loadBank valida estructura y exige ground truth en cada caso', () => {
    expect(loadBank(BANK).cases).toHaveLength(4);
    expect(() => loadBank({ bank_id: 'b', capability_id: 'c', cases: [{ case_id: 'x', input: 'i', expected: '' }] })).toThrow(/ground truth/);
    expect(() => loadBank({})).toThrow(/inválido/);
  });
});

describe('kagami/bank — K-08 corrida vs banco con confianza declarada', () => {
  const solveCorrect = async (i: string) => String(eval(i));   // a perfect solver
  const solveHalf = async (i: string) => (i === '2+2' || i === '10+5' ? String(eval(i)) : 'no sé');   // exactly 2/4

  it('solver perfecto + confianza acorde → RELIABLE, gap pequeño', async () => {
    const bank = loadBank(BANK);
    const run = await runBank(bank, solveCorrect, exactGrader);
    expect(run.success_rate).toBe(1);
    const cell = measureFromBank(bank, run, 0.9, 't');
    expect(cell.verdict).toBe('RELIABLE');
    expect(cell.calibration_gap).toBeCloseTo(0.1, 5);
  });

  it('TEMERIDAD: solver flojo (0.5) pero confianza alta (0.95) → no RELIABLE, gap grande', async () => {
    const bank = loadBank(BANK);
    const run = await runBank(bank, solveHalf, exactGrader);
    expect(run.success_rate).toBe(0.5);
    const cell = measureFromBank(bank, run, 0.95, 't');
    expect(cell.verdict).not.toBe('RELIABLE');         // measured, not presumed
    expect(cell.calibration_gap).toBeCloseTo(0.45, 5); // overconfidence exposed
  });

  it('un solver que casca un caso no rompe la corrida (cuenta como fallo)', async () => {
    const bank = loadBank(BANK);
    const run = await runBank(bank, async (i) => { if (i === '7+1') throw new Error('boom'); return String(eval(i)); });
    expect(run.passed).toBe(3); expect(run.total).toBe(4);
  });
});
