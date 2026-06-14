/**
 * scripts/regression.ts — F0 MANDATORY regression (CONTRACT §4 / §7).
 *
 * Runs the canonical 30 real tasks through the ACTUAL CLI (`sello run`) twice:
 *   - oracle subject → expect 30/30 PASS
 *   - naive  subject → expect  0/30 PASS
 * Verdicts are read from RAW CLI stdout (this is the contract's acceptance gate:
 * "por salida cruda de CLI sobre las 30 reales"). Exits non-zero unless the
 * split is exactly 30/30 ÷ 0/30.
 */

import { spawnSync } from 'node:child_process';
import { loadBank } from '../src/harness/bank.ts';
import { PATHS } from '../src/core/paths.ts';

const ORACLE_CMD = 'node src/harness/subjects/oracle.mjs';
const NAIVE_CMD = 'node src/harness/subjects/naive.mjs';

function runCli(taskId: string, subjectCmd: string): { verdict: string; raw: string } {
  const cli = `npx tsx src/cli/sello.ts run ${taskId} ${subjectCmd}`;
  const r = spawnSync(cli, { shell: true, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  const raw = (r.stdout ?? '') + (r.stderr ?? '');
  try {
    const parsed = JSON.parse(r.stdout ?? '');
    return { verdict: parsed?.result?.verdict ?? 'PARSE_ERROR', raw };
  } catch {
    return { verdict: 'PARSE_ERROR', raw };
  }
}

function runSuite(label: string, subjectCmd: string, ids: string[]) {
  console.log(`\n── ${label} (${subjectCmd}) ─────────────────────────────`);
  let pass = 0;
  const rows: string[] = [];
  for (const id of ids) {
    const { verdict } = runCli(id, subjectCmd);
    if (verdict === 'PASS') pass++;
    const mark = verdict === 'PASS' ? 'PASS' : verdict;
    rows.push(`  ${id.padEnd(34)} ${mark}`);
  }
  console.log(rows.join('\n'));
  console.log(`  ── ${label}: ${pass}/${ids.length} PASS`);
  return pass;
}

const bank = loadBank(PATHS.bank);
const ids = bank.map((t) => t.task_id);
console.log(`Sello F0 regression — ${ids.length} real tasks, via raw CLI (sello run)`);

const oraclePass = runSuite('ORACLE subject', ORACLE_CMD, ids);
const naivePass = runSuite('NAIVE subject', NAIVE_CMD, ids);

console.log('\n════════════════════════════════════════════════════════════');
console.log(`RESULT: oracle ${oraclePass}/${ids.length}  ÷  naive ${naivePass}/${ids.length}`);
const ok = oraclePass === ids.length && naivePass === 0 && ids.length === 30;
console.log(ok ? '✓ F0 GATE PASSED (30/30 ÷ 0/30)' : '✖ F0 GATE FAILED');
console.log('════════════════════════════════════════════════════════════');
process.exit(ok ? 0 : 1);
