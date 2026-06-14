/**
 * harness/bank.ts — canonical task bank loader (CONTRACT §4).
 *
 * The canonical bank is bank/pilot_agentic_v1.jsonl: the 30 real tasks
 * extracted verbatim from OpenGravity's pilot_agentic_v1_bvp.ts. One JSON
 * object per line.
 */

import fs from 'node:fs';

export interface BankTask {
  task_id: string;
  category: string;
  name: string;
  grader: string;                       // GraderKind (CONTRACT §5)
  grader_config: Record<string, unknown>;
  mode: 'clean';
  input: Record<string, unknown>;       // { prompt: string }
  oracle_output: Record<string, unknown> | null;
  oracle_type: 'exact' | 'valid_set' | 'threshold';
  adversarial: boolean;
  added_version: string;
}

export function loadBank(bankPath: string): BankTask[] {
  if (!fs.existsSync(bankPath)) throw new Error(`bank not found: ${bankPath}`);
  return fs
    .readFileSync(bankPath, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => {
      try { return JSON.parse(l) as BankTask; }
      catch (e: any) { throw new Error(`bank line ${i + 1} is not valid JSON: ${e.message}`); }
    });
}

export function getTask(bank: BankTask[], taskId: string): BankTask {
  const t = bank.find((x) => x.task_id === taskId);
  if (!t) throw new Error(`task_id not in bank: ${taskId}`);
  return t;
}
