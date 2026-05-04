// E2E for the demo runner without touching OBS (--no-record).
// Asserts both modes produce a transcript file, finish in non-zero verdicts,
// and the recording field is shaped correctly.
import { existsSync, statSync, rmSync } from 'node:fs';
import { runDemo } from '../demo_runner.js';

async function main() {
  // Mode 1 — single task
  const r1 = await runDemo({ task_id: 'T16', noRecord: true });
  if (r1.task_results.length !== 1) throw new Error(`expected 1 result, got ${r1.task_results.length}`);
  if (r1.task_results[0].verdict !== 'PASS') throw new Error(`T16 should PASS in stub`);
  if (!existsSync(r1.transcript_path)) throw new Error(`transcript missing`);
  if (statSync(r1.transcript_path).size < 50) throw new Error(`transcript too small`);
  if (!r1.recording.skipped) throw new Error(`recording.skipped expected`);

  // Mode 2 — full self improve subset
  const r2 = await runDemo({ fullSelfImprove: true, noRecord: true });
  if (r2.task_results.length < 5) throw new Error(`expected >=5 results, got ${r2.task_results.length}`);
  const passed = r2.task_results.filter((t) => t.verdict === 'PASS').length;
  if (passed < 5) throw new Error(`expected >=5 PASS in stub run, got ${passed}`);
  if (!existsSync(r2.transcript_path)) throw new Error(`transcript missing`);

  // Cleanup test transcripts
  try { rmSync(r1.transcript_path); } catch {}
  try { rmSync(r2.transcript_path); } catch {}

  console.log('[h4-h5-e2e] OK', { task_run_results: r1.task_results.length, full_run_passed: passed });
}

main().catch((e) => { console.error('[h4-h5-e2e] FAIL', e); process.exit(1); });
