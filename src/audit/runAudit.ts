// D.3 — `shinobi audit <github_url>` orquesta clone → HierarchicalReader →
// Committee → render markdown segun el contrato firmado en docs/MISSION_PILOT.md.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { HierarchicalReader, renderTelemetryTree, type TelemetryNode } from '../reader/HierarchicalReader.js';
import { makeLLMClient } from '../reader/llm_adapter.js';
import { Committee, type CommitteeResult } from '../committee/Committee.js';
import type { RepoReport, SubReport, SubReportError } from '../reader/schemas.js';
import { MissionLedger } from '../ledger/MissionLedger.js';

export interface AuditOptions {
  url: string;
  commit?: string;        // optional pinned SHA
  budgetTokens?: number;
  /** Output dir for the rendered audit. Default: <cwd>/audits */
  outDir?: string;
  /** Optional working dir to clone into. Default: tmp. */
  cloneInto?: string;
}

export interface AuditResult {
  ok: boolean;
  verdict: 'PASS' | 'FAIL';
  overallRisk: 'low' | 'medium' | 'high';
  mdPath: string;
  machinePath: string;
  durationMs: number;
  contractPass: boolean;
  contractReasons: string[];        // empty when contractPass true
  owner: string;
  repo: string;
  sha: string;
}

const TIMEOUT_BUDGET_MS = 5 * 60 * 1_000;  // §6.1 + §3.3 / D.1 contract: ≤5 min wall-clock

function parseGithubUrl(url: string): { owner: string; repo: string } {
  const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?\/?(?:[?#].*)?$/i);
  if (!m) throw new Error(`not a github repo URL: ${url}`);
  return { owner: m[1], repo: m[2] };
}

function shaShort(sha: string): string { return sha.slice(0, 8); }

function runGit(args: string[], cwd?: string): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  return { ok: r.status === 0, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

function listAllPaths(repoAbs: string): Set<string> {
  // Used by hallucination check. Returns set of repo-relative POSIX paths.
  const r = runGit(['ls-tree', '-r', '--name-only', 'HEAD'], repoAbs);
  if (!r.ok) return new Set();
  return new Set(r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
}

function pathExistsInTree(needle: string, tree: Set<string>): boolean {
  const norm = needle.replace(/\\/g, '/').replace(/^\//, '');
  if (tree.has(norm)) return true;
  // Allow directory references (any file with that prefix).
  for (const p of tree) if (p === norm || p.startsWith(norm.endsWith('/') ? norm : norm + '/')) return true;
  // Tolerate "src/foo" referenced when actual is "src/foo.ts" etc.
  for (const p of tree) {
    if (p === norm) return true;
    const stem = p.replace(/\.[a-z0-9]+$/i, '');
    if (stem === norm) return true;
  }
  return false;
}

function risksReferenceRealPaths(report: RepoReport, committee: CommitteeResult, tree: Set<string>): { ok: boolean; offenders: string[] } {
  // Heuristic: extract `path-like` tokens from each risk description; require
  // at least one real path token if any path token appears, else accept.
  const offenders: string[] = [];
  const allRisks: string[] = [
    ...report.risks.map((r) => r.description),
    ...('error' in committee.synthesis ? [] : committee.synthesis.consensus.map((c) => c.topic)),
    ...('error' in committee.synthesis ? [] : committee.synthesis.dissents.flatMap((d) => [d.topic, ...d.positions.map((p) => p.position)])),
  ];
  const pathRegex = /(?:^|[\s`'"])((?:src|lib|test|tests|docs|scripts|app|packages|cmd|pkg|internal)\/[A-Za-z0-9_./\-]+)/g;
  for (const desc of allRisks) {
    let m: RegExpExecArray | null;
    let found = false;
    let any = false;
    while ((m = pathRegex.exec(desc)) !== null) {
      any = true;
      if (pathExistsInTree(m[1], tree)) { found = true; break; }
    }
    if (any && !found) offenders.push(desc);
  }
  return { ok: offenders.length === 0, offenders };
}

function renderAuditMd(args: {
  owner: string; repo: string; sha: string;
  url: string;
  report: RepoReport;
  committee: CommitteeResult;
  verdict: 'PASS' | 'FAIL';
  overallRisk: 'low' | 'medium' | 'high';
  durationMs: number;
  subagentCount: number;
  evidenceRel: string;     // "<sha>_*.json"
}): string {
  const ts = new Date().toISOString();
  const lines: string[] = [];
  lines.push(`# Audit: ${args.owner}/${args.repo}@${shaShort(args.sha)}`);
  lines.push('');
  lines.push(`Generated: ${ts}`);
  lines.push(`Source:    ${args.url}`);
  lines.push(`Commit:    ${args.sha}`);
  lines.push(`Verdict:   ${args.verdict}  (overall_risk = ${args.overallRisk})`);
  lines.push('');
  lines.push('## Purpose');
  lines.push(args.report.repo_purpose);
  lines.push('');
  lines.push('## Architecture');
  lines.push(args.report.architecture_summary);
  lines.push('');

  // Risks: combine + dedup + sort by severity
  const sevRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const memberRisks = ('error' in args.committee.synthesis)
    ? []
    : args.committee.members.filter((m): m is Exclude<typeof m, { error: string }> => !('error' in m))
        .flatMap((m) => m.weaknesses.map((w) => ({ severity: m.risk_level, description: w })));
  const allRisks = [...args.report.risks, ...memberRisks];
  const seen = new Set<string>();
  const dedupRisks = allRisks
    .filter((r) => { const k = r.description.toLowerCase().trim(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);

  lines.push('## Risks');
  if (dedupRisks.length === 0) lines.push('(none reported)');
  dedupRisks.forEach((r, i) => lines.push(`${i + 1}. [${r.severity.toUpperCase()}] ${r.description}`));
  lines.push('');

  // Recommendations: top 6 from committee combined
  const recs = ('error' in args.committee.synthesis)
    ? []
    : args.committee.synthesis.combined_recommendations.slice(0, 6);
  lines.push('## Recommendations');
  if (recs.length === 0) lines.push('(none — committee did not produce recommendations)');
  recs.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
  lines.push('');

  lines.push('## Auditors');
  for (const m of args.committee.members) {
    if ('error' in m) lines.push(`- ${m.role}: ERROR (${m.error})`);
    else lines.push(`- ${m.role.padEnd(18)} risk=${m.risk_level}`);
  }
  lines.push('');

  lines.push('## Evidence');
  lines.push(`- repo_report:    audits/.machine/${args.evidenceRel}_report.json`);
  lines.push(`- subreports:     audits/.machine/${args.evidenceRel}_subreports.json`);
  lines.push(`- committee:      audits/.machine/${args.evidenceRel}_committee.json`);
  lines.push(`- telemetry:      audits/.machine/${args.evidenceRel}_telemetry.json`);
  lines.push(`- duration_ms:    ${args.durationMs}`);
  lines.push(`- subagent_count: ${args.subagentCount}`);
  return lines.join('\n') + '\n';
}

function checkContract(args: {
  mdContent: string;
  durationMs: number;
  pathChecks: { ok: boolean; offenders: string[] };
  verdict: 'PASS' | 'FAIL';
  overallRisk: 'low' | 'medium' | 'high';
  machineExist: boolean;
}): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  // 1. The audit_*.md file exists in audits/   ← ensured by caller (writes before calling)
  // 2. 5 sections present
  const requiredSections = ['## Purpose', '## Architecture', '## Risks', '## Recommendations'];
  const verdictLine = /^Verdict:\s+(PASS|FAIL)/m;
  for (const s of requiredSections) if (!args.mdContent.includes(s)) reasons.push(`missing section ${s}`);
  if (!verdictLine.test(args.mdContent)) reasons.push('missing Verdict line');
  // 3. Path hallucination check
  if (!args.pathChecks.ok) reasons.push(`risks reference non-existent paths: ${args.pathChecks.offenders.length}`);
  // 4. Verdict ↔ overallRisk consistency
  const expected = args.overallRisk === 'high' ? 'FAIL' : 'PASS';
  if (args.verdict !== expected) reasons.push(`verdict=${args.verdict} inconsistent with overall_risk=${args.overallRisk}`);
  // 5. Duration ≤ 5 min
  if (args.durationMs > TIMEOUT_BUDGET_MS) reasons.push(`duration ${args.durationMs}ms > ${TIMEOUT_BUDGET_MS}ms`);
  // 6. Machine evidence persisted
  if (!args.machineExist) reasons.push('machine evidence files missing');
  return { pass: reasons.length === 0, reasons };
}

export async function runAudit(opts: AuditOptions): Promise<AuditResult> {
  const t0 = Date.now();
  const { owner, repo } = parseGithubUrl(opts.url);
  const cloneRoot = opts.cloneInto ?? fs.mkdtempSync(path.join(os.tmpdir(), `shinobi-audit-${owner}-${repo}-`));
  let cleanupClone = !opts.cloneInto;

  try {
    console.log(`[audit] cloning ${opts.url} → ${cloneRoot}`);
    const cloneArgs = ['clone', '--depth', '1'];
    // For pinned commits, we still shallow-clone the default branch then fetch the specific commit if needed.
    cloneArgs.push(opts.url, cloneRoot);
    const cl = runGit(cloneArgs);
    if (!cl.ok) throw new Error(`git clone failed: ${cl.stderr}`);

    if (opts.commit) {
      console.log(`[audit] fetching pinned commit ${opts.commit}`);
      runGit(['fetch', '--depth', '1', 'origin', opts.commit], cloneRoot);
      const co = runGit(['checkout', opts.commit], cloneRoot);
      if (!co.ok) throw new Error(`git checkout ${opts.commit} failed: ${co.stderr}`);
    }

    const headSha = runGit(['rev-parse', 'HEAD'], cloneRoot).stdout || 'unknown';
    console.log(`[audit] HEAD=${headSha}`);

    // Habilidad D.2 — depth=2 hierarchical read.
    const reader = new HierarchicalReader({
      llm: makeLLMClient(),
      depth: 2,
      missionId: `audit-${owner}-${repo}-${shaShort(headSha)}`,
      onProgress: (ev) => {
        if (ev.node && (ev.phase === 'sub_supervisor_done' || ev.phase === 'leaf_done' || ev.phase === 'final_synth_done')) {
          console.log(`[audit] ${ev.phase} ${ev.node.label} (${ev.node.duration_ms}ms)`);
        }
      },
    });
    const readResult = await reader.read(cloneRoot);
    if (!readResult.ok || !readResult.report) {
      throw new Error(`HierarchicalReader failed: ${readResult.error ?? 'unknown'}`);
    }

    // Habilidad B.2 — Committee.
    console.log('[audit] committee dispatching…');
    const committee = new Committee({ llm: makeLLMClient() });
    const cmt = await committee.review(JSON.stringify(readResult.report));

    const overallRisk: 'low' | 'medium' | 'high' = ('error' in cmt.synthesis)
      ? (readResult.report.risks.find((r) => r.severity === 'high') ? 'high' : 'medium')
      : cmt.synthesis.overall_risk;
    const verdict: 'PASS' | 'FAIL' = overallRisk === 'high' ? 'FAIL' : 'PASS';

    // Hallucination check before declaring contract pass.
    const tree = listAllPaths(cloneRoot);
    const pathChecks = risksReferenceRealPaths(readResult.report, cmt, tree);

    // Persist machine evidence.
    const outDir = opts.outDir ?? path.join(process.cwd(), 'audits');
    const machineDir = path.join(outDir, '.machine');
    fs.mkdirSync(machineDir, { recursive: true });
    const evidenceBase = `${headSha}`;
    const writeMachine = (suffix: string, payload: any) =>
      fs.writeFileSync(path.join(machineDir, `${evidenceBase}_${suffix}.json`), JSON.stringify(payload, null, 2));
    writeMachine('report', readResult.report);
    writeMachine('subreports', readResult.subreports);
    writeMachine('committee', { members: cmt.members, synthesis: cmt.synthesis });
    writeMachine('telemetry', readResult.telemetry);
    fs.writeFileSync(path.join(machineDir, `${evidenceBase}_tree.txt`), renderTelemetryTree(readResult.telemetry));

    // Render the audit MD according to D.1 contract.
    const dur = Date.now() - t0;
    const md = renderAuditMd({
      owner, repo, sha: headSha,
      url: opts.url,
      report: readResult.report,
      committee: cmt,
      verdict, overallRisk,
      durationMs: dur,
      subagentCount: readResult.report.evidence.subagent_count,
      evidenceRel: evidenceBase,
    });
    const mdPath = path.join(outDir, `${owner}__${repo}__${shaShort(headSha)}.md`);
    fs.writeFileSync(mdPath, md);

    // Contract verification.
    const machineExist = ['report', 'subreports', 'committee', 'telemetry']
      .every((s) => fs.existsSync(path.join(machineDir, `${evidenceBase}_${s}.json`)));
    const contract = checkContract({
      mdContent: md,
      durationMs: dur,
      pathChecks,
      verdict,
      overallRisk,
      machineExist,
    });

    // D.4 — record this audit in the immutable mission ledger.
    try {
      const ledger = new MissionLedger();
      const entry = ledger.record({
        mission_id: `audit-${owner}-${repo}-${shaShort(headSha)}`,
        input: opts.url + (opts.commit ? `@${opts.commit}` : ''),
        output: md,
        model_calls: readResult.report.evidence.subagent_count + 1 /* committee synth */ + 3 /* committee members */,
        total_cost: 0,
      });
      console.log(`[ledger] entry recorded — self_hash=${entry.self_hash.slice(0, 12)}…`);
    } catch (e: any) {
      console.warn(`[ledger] failed to record: ${e?.message ?? e}`);
    }

    console.log('');
    console.log('───── AUDIT RESULT ─────');
    console.log(`repo:      ${owner}/${repo}@${shaShort(headSha)}`);
    console.log(`verdict:   ${verdict}  (overall_risk=${overallRisk})`);
    console.log(`duration:  ${(dur / 1000).toFixed(1)}s`);
    console.log(`contract:  ${contract.pass ? 'PASS' : 'FAIL'}`);
    if (!contract.pass) for (const r of contract.reasons) console.log(`  - ${r}`);
    console.log(`md:        ${mdPath}`);
    console.log('────────────────────────');

    return {
      ok: true,
      verdict,
      overallRisk,
      mdPath,
      machinePath: machineDir,
      durationMs: dur,
      contractPass: contract.pass,
      contractReasons: contract.reasons,
      owner, repo, sha: headSha,
    };
  } finally {
    if (cleanupClone) {
      try { fs.rmSync(cloneRoot, { recursive: true, force: true }); } catch { /* tolerate */ }
    }
  }
}

export function parseAuditCliArgs(argv: string[]): { url?: string; commit?: string; budgetTokens?: number; error?: string } {
  // argv = ["audit", "<url>", "--commit=<sha>", "--budget=<n>"]
  if (argv[0] !== 'audit') return { error: 'first arg must be "audit"' };
  const url = argv[1];
  if (!url || !/^https:\/\/github\.com\//i.test(url)) return { error: 'second arg must be https://github.com/owner/repo' };
  let commit: string | undefined;
  let budgetTokens: number | undefined;
  for (const a of argv.slice(2)) {
    if (a.startsWith('--commit=')) commit = a.slice('--commit='.length);
    else if (a.startsWith('--budget=')) {
      const n = parseInt(a.slice('--budget='.length), 10);
      if (Number.isFinite(n) && n > 0) budgetTokens = n;
      else return { error: `invalid --budget value: ${a}` };
    }
  }
  return { url, commit, budgetTokens };
}
