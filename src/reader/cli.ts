// Habilidad A — CLI integration for /read.
// Exposed as a function so /self (B.1) can reuse the same flow.

import * as fs from 'fs';
import * as path from 'path';
import { RepoReader, DEFAULT_BUDGET, type Budget } from './RepoReader.js';
import { makeLLMClient } from './llm_adapter.js';

export interface RunReadOptions {
  budgetTokens?: number;
  /** label used as missions/<timestamp>_<label>/ — default 'read' */
  label?: string;
}

export interface RunReadResult {
  ok: boolean;
  missionDir: string;
  durationMs: number;
}

export async function runRead(repoPath: string, opts: RunReadOptions = {}): Promise<RunReadResult> {
  const repoAbs = path.resolve(repoPath);
  if (!fs.existsSync(repoAbs)) {
    console.log(`[read] path does not exist: ${repoAbs}`);
    return { ok: false, missionDir: '', durationMs: 0 };
  }

  const budget: Budget = (() => {
    if (!opts.budgetTokens) return DEFAULT_BUDGET;
    const tokensTotal = Math.max(8_000, opts.budgetTokens);
    const maxSubagents = Math.max(2, Math.min(12, Math.floor(tokensTotal / 8_000)));
    return { ...DEFAULT_BUDGET, tokensTotal, maxSubagents };
  })();

  const t0 = Date.now();
  console.log(`[read] target: ${repoAbs}`);
  console.log(`[read] budget: ${budget.maxSubagents} sub-agents, ${budget.tokensTotal} tokens cap`);

  const reader = new RepoReader({
    llm: makeLLMClient(),
    budget,
    onProgress: (ev) => {
      if (ev.phase === 'partition') console.log(`[read] partitioning ${ev.detail}`);
      else if (ev.phase === 'spawn') console.log(`[read] spawning ${ev.detail}`);
      else if (ev.phase === 'subagent_done') console.log(`[read]   ✓ ${ev.detail}`);
      else if (ev.phase === 'synthesize') console.log(`[read] synthesizing with Opus…`);
    },
  });

  const result = await reader.read(repoAbs);
  const dur = Date.now() - t0;

  // Persist to missions/<timestamp>_<label>/
  const label = opts.label ?? 'read';
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const missionDir = path.join(process.cwd(), 'missions', `${ts}_${label}`);
  fs.mkdirSync(missionDir, { recursive: true });

  fs.writeFileSync(
    path.join(missionDir, 'subreports.json'),
    JSON.stringify(result.subreports, null, 2),
  );
  fs.writeFileSync(
    path.join(missionDir, 'meta.json'),
    JSON.stringify({
      target: repoAbs,
      budget,
      duration_ms: dur,
      ok: result.ok,
      timestamp: ts,
    }, null, 2),
  );

  if (!result.ok) {
    console.log('');
    console.log('[read] FAILED:', result.error);
    console.log(`[read] partial sub-reports written to ${missionDir}`);
    return { ok: false, missionDir, durationMs: dur };
  }

  fs.writeFileSync(
    path.join(missionDir, 'report.json'),
    JSON.stringify(result.report, null, 2),
  );

  // Pretty-print to terminal
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`REPO: ${repoAbs}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('PURPOSE');
  console.log(`  ${result.report.repo_purpose}`);
  console.log('');
  console.log('ARCHITECTURE');
  result.report.architecture_summary.split('\n').forEach((l) => console.log(`  ${l}`));
  console.log('');
  console.log('MODULES');
  for (const m of result.report.modules) {
    console.log(`  - ${m.name} (${m.path}) — ${m.responsibility}`);
  }
  console.log('');
  console.log('ENTRY POINTS');
  for (const e of result.report.entry_points) {
    console.log(`  - ${e.file} [${e.kind}]`);
  }
  if (result.report.risks.length) {
    console.log('');
    console.log('RISKS');
    for (const r of result.report.risks) {
      console.log(`  [${r.severity.toUpperCase()}] ${r.description}`);
    }
  }
  console.log('');
  console.log(`[read] done in ${(dur / 1000).toFixed(1)}s — ${result.subreports.length} sub-reports`);
  console.log(`[read] artifacts: ${missionDir}`);
  console.log('');

  return { ok: true, missionDir, durationMs: dur };
}

// Parse `/read <path> [--budget=N]`
export function parseReadArgs(argv: string): { path?: string; budgetTokens?: number; error?: string } {
  // argv is the substring after "/read "
  const tokens = argv.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { error: 'Usage: /read <path> [--budget=N]' };
  let pathArg: string | undefined;
  let budgetTokens: number | undefined;
  for (const t of tokens) {
    if (t.startsWith('--budget=')) {
      const n = parseInt(t.slice('--budget='.length), 10);
      if (Number.isFinite(n) && n > 0) budgetTokens = n;
      else return { error: `invalid --budget value: ${t}` };
    } else if (!pathArg) {
      pathArg = t;
    }
  }
  if (!pathArg) return { error: 'Usage: /read <path> [--budget=N]' };
  return { path: pathArg, budgetTokens };
}
