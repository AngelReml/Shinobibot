// Habilidad B.1 — comando /self: Shinobi se lee a sí mismo via Habilidad A.
// Reusa runRead() y guarda el report en self_reports/<timestamp>.json.
// --diff compara el último report con el penúltimo y resalta cambios.

import * as fs from 'fs';
import * as path from 'path';
import { runRead } from './cli.js';
import type { RepoReport } from './schemas.js';

const SELF_REPORTS_DIR = path.join(process.cwd(), 'self_reports');

export interface RunSelfOptions {
  budgetTokens?: number;
}

export interface RunSelfResult {
  ok: boolean;
  selfReportPath: string;
  missionDir: string;
}

function shinobiRoot(): string {
  // The repo root is the cwd of the running process — same as Habilidad A.
  return process.cwd();
}

export async function runSelf(opts: RunSelfOptions = {}): Promise<RunSelfResult> {
  const root = shinobiRoot();
  console.log(`[self] reading shinobibot at ${root}`);
  const r = await runRead(root, { budgetTokens: opts.budgetTokens, label: 'self' });

  if (!r.ok) {
    return { ok: false, selfReportPath: '', missionDir: r.missionDir };
  }

  // Copy the synthesized report into self_reports/<timestamp>.json for B.1 audit chain.
  if (!fs.existsSync(SELF_REPORTS_DIR)) fs.mkdirSync(SELF_REPORTS_DIR, { recursive: true });
  const reportSrc = path.join(r.missionDir, 'report.json');
  if (!fs.existsSync(reportSrc)) {
    return { ok: false, selfReportPath: '', missionDir: r.missionDir };
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(SELF_REPORTS_DIR, `${ts}.json`);
  fs.copyFileSync(reportSrc, dest);
  console.log(`[self] report archived at ${dest}`);
  return { ok: true, selfReportPath: dest, missionDir: r.missionDir };
}

function listSelfReports(): string[] {
  if (!fs.existsSync(SELF_REPORTS_DIR)) return [];
  return fs.readdirSync(SELF_REPORTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
}

interface DiffEntry { kind: 'added' | 'removed' | 'changed'; key: string; before?: string; after?: string }

function diffStrSet(a: Set<string>, b: Set<string>, label: string): DiffEntry[] {
  const out: DiffEntry[] = [];
  for (const x of b) if (!a.has(x)) out.push({ kind: 'added', key: `${label}:${x}` });
  for (const x of a) if (!b.has(x)) out.push({ kind: 'removed', key: `${label}:${x}` });
  return out;
}

function diffReports(prev: RepoReport, cur: RepoReport): DiffEntry[] {
  const diffs: DiffEntry[] = [];
  if (prev.repo_purpose !== cur.repo_purpose) {
    diffs.push({ kind: 'changed', key: 'repo_purpose', before: prev.repo_purpose, after: cur.repo_purpose });
  }
  const prevMods = new Set(prev.modules.map((m) => `${m.name}@${m.path}`));
  const curMods = new Set(cur.modules.map((m) => `${m.name}@${m.path}`));
  diffs.push(...diffStrSet(prevMods, curMods, 'module'));

  const prevEntries = new Set(prev.entry_points.map((e) => `${e.file}[${e.kind}]`));
  const curEntries = new Set(cur.entry_points.map((e) => `${e.file}[${e.kind}]`));
  diffs.push(...diffStrSet(prevEntries, curEntries, 'entry_point'));

  const prevRisks = new Set(prev.risks.map((r) => `${r.severity}:${r.description}`));
  const curRisks = new Set(cur.risks.map((r) => `${r.severity}:${r.description}`));
  diffs.push(...diffStrSet(prevRisks, curRisks, 'risk'));

  return diffs;
}

export async function runSelfDiff(): Promise<{ ok: boolean; diffs: DiffEntry[] }> {
  const reports = listSelfReports();
  if (reports.length < 2) {
    console.log('[self --diff] need at least 2 self_reports/ entries; run /self twice first');
    return { ok: false, diffs: [] };
  }
  const prev = JSON.parse(fs.readFileSync(path.join(SELF_REPORTS_DIR, reports[reports.length - 2]), 'utf-8')) as RepoReport;
  const cur = JSON.parse(fs.readFileSync(path.join(SELF_REPORTS_DIR, reports[reports.length - 1]), 'utf-8')) as RepoReport;
  const diffs = diffReports(prev, cur);

  console.log('');
  console.log(`[self --diff] ${reports[reports.length - 2]}  →  ${reports[reports.length - 1]}`);
  console.log('');
  if (diffs.length === 0) {
    console.log('  (no structural changes detected between the two reports)');
  } else {
    for (const d of diffs) {
      if (d.kind === 'changed') {
        console.log(`  ~ ${d.key}`);
        console.log(`      before: ${d.before}`);
        console.log(`      after:  ${d.after}`);
      } else {
        const sym = d.kind === 'added' ? '+' : '-';
        console.log(`  ${sym} ${d.key}`);
      }
    }
  }
  console.log('');
  return { ok: true, diffs };
}

export function parseSelfArgs(argv: string): { diff: boolean; budgetTokens?: number; error?: string } {
  const tokens = argv.trim().split(/\s+/).filter(Boolean);
  let diff = false;
  let budgetTokens: number | undefined;
  for (const t of tokens) {
    if (t === '--diff') diff = true;
    else if (t.startsWith('--budget=')) {
      const n = parseInt(t.slice('--budget='.length), 10);
      if (Number.isFinite(n) && n > 0) budgetTokens = n;
      else return { diff, error: `invalid --budget value: ${t}` };
    } else {
      return { diff, error: `unknown arg: ${t}` };
    }
  }
  return { diff, budgetTokens };
}
