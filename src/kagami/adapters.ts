/**
 * kagami/adapters.ts — K-03: the ⚠ ENGANCHE seams that feed Pillar A/B/C from the
 * REAL tools, verified against the real module signatures (the GATE: they compile).
 * guard.ts is pure (it assembles a snapshot from given results); these adapters are
 * what RUN vitest / tsc / lint / LSP and parse their output into those results, plus
 * the Sello-grader and agent-loop seams. Command execution is injectable (defaults
 * to the real local sandbox backend), so the PARSERS are tested on canned output
 * without actually shelling out in CI.
 */

import { sandboxRegistry } from '../sandbox/registry.js';
import { runDiagnostics } from '../lsp/diagnostics.js';
import { verifyCsvCertificate, type SkillCSVLike } from '../integrity/csv_verify.js';
import type { ExamResult } from './types.js';

// ── LSP + Sello seams (re-export the real things Kagami uses) ───────────────────
export { runDiagnostics } from '../lsp/diagnostics.js';
export { verifyCsvCertificate } from '../integrity/csv_verify.js';

export type CmdRunner = (command: string, cwd?: string, timeoutMs?: number) => Promise<{ success: boolean; stdout: string; stderr: string }>;

const defaultRunner: CmdRunner = async (command, cwd = process.cwd(), timeoutMs = 600_000) => {
  const backend = sandboxRegistry().get('local');
  if (!backend) return { success: false, stdout: '', stderr: 'no local backend' };
  const r = await backend.run({ command, cwd, timeoutMs });
  return { success: r.success, stdout: r.stdout, stderr: r.stderr };
};

// ── Pure parsers (the testable core of the runner seams) ────────────────────────

export interface SuiteResult { passed: number; failed: number; skipped: number; duration_ms: number; }

/** Parse a vitest text summary (`Tests N passed | M skipped (T)` + `Duration Xs`). */
export function parseVitestSummary(stdout: string): SuiteResult {
  const num = (re: RegExp) => { const m = stdout.match(re); return m ? Number(m[1]) : 0; };
  const passed = num(/(\d+)\s+passed/);
  const failed = num(/(\d+)\s+failed/);
  const skipped = num(/(\d+)\s+skipped/);
  const durSec = stdout.match(/Duration\s+([\d.]+)s/);
  const duration_ms = durSec ? Math.round(Number(durSec[1]) * 1000) : 0;
  return { passed, failed, skipped, duration_ms };
}

/** Count `error TS####` occurrences in a tsc --noEmit run. */
export function parseTscErrors(stdout: string): number {
  return (stdout.match(/error TS\d+/g) ?? []).length;
}

/** Best-effort lint warning count (eslint `N problems (… warnings)` or bare `warning`). */
export function parseLintWarnings(stdout: string): number {
  const m = stdout.match(/(\d+)\s+warnings?/);
  if (m) return Number(m[1]);
  return (stdout.match(/\bwarning\b/gi) ?? []).length;
}

// ── Runner seams (run the real tool, parse the result) ──────────────────────────

export async function runSuite(run: CmdRunner = defaultRunner, cmd = 'npx vitest run'): Promise<SuiteResult> {
  const r = await run(cmd);
  return parseVitestSummary(r.stdout + '\n' + r.stderr);
}
export async function runTypecheck(run: CmdRunner = defaultRunner, cmd = 'npx tsc --noEmit'): Promise<number> {
  const r = await run(cmd);
  return parseTscErrors(r.stdout + '\n' + r.stderr);
}
export async function runLint(run: CmdRunner = defaultRunner, cmd = 'npx eslint . --format unix'): Promise<number> {
  const r = await run(cmd);
  return parseLintWarnings(r.stdout + '\n' + r.stderr);
}

/** LSP seam: how many error-level diagnostics a file has (Pillar A static health). */
export async function lspErrorCount(filePath: string, content?: string): Promise<number> {
  const diags = await runDiagnostics(filePath, content);
  return diags.filter((d) => d.severity === 'error').length;
}

/**
 * Sello-grader seam (Pillar C, graded_by 'sello_grader'): grade an exam by verifying
 * a skill's CSV certificate — CERTIFIED + valid signature ⇒ passed. The external
 * anchor (ground_truth_ref) is the CSV's skill_id, never self-asserted.
 */
export function selloGradeExam(csv: SkillCSVLike, examId: string, rubric: string, takenAt: string): ExamResult {
  const v = verifyCsvCertificate(csv);
  return {
    exam_id: examId, rubric,
    ground_truth_ref: `csv:${csv.subject?.skill_id ?? 'unknown'}`,
    score: v.ok ? 1 : 0, passed: v.ok, graded_by: 'sello_grader', taken_at: takenAt,
  };
}
