// S1.5 — reader stress test sobre 3 repos grandes reales.
// UNA corrida por repo, depth=1 (default de runRead), sin voting.
// Captura: durada, sub-agentes, archivos cubiertos vs presentes, tokens
// estimados, archivos perdidos en misc/, calidad del report sintetizado.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { runRead } from '../src/reader/cli.js';
import { LLMGateway } from '../src/gateway/llm.js';
import { makeLLMClient } from '../src/reader/llm_adapter.js';

interface RepoTarget { name: string; url: string }
const REPOS: RepoTarget[] = [
  { name: 'kubernetes', url: 'https://github.com/kubernetes/kubernetes' },
  { name: 'react',      url: 'https://github.com/facebook/react' },
  { name: 'langchain',  url: 'https://github.com/langchain-ai/langchain' },
];

interface RunRecord {
  repo: string;
  url: string;
  cloneSha: string;
  cloneSizeBytes: number;
  cloneDurationMs: number;
  totalFiles: number;
  topLevelEntries: number;
  readOk: boolean;
  readDurationMs: number;
  subagentCount: number;
  miscBranchPresent: boolean;
  filesCoveredApprox: number;
  filesIgnoredApprox: number;
  estimatedTokensIn: number;
  estimatedTokensOut: number;
  reportSummary: string;
  reportError?: string;
  missionDir: string;
}
const records: RunRecord[] = [];

function dirSize(p: string): number {
  let total = 0;
  const stack = [p];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name === '.git') continue;
      const abs = path.join(cur, e.name);
      try {
        if (e.isDirectory()) stack.push(abs);
        else if (e.isFile()) total += fs.statSync(abs).size;
      } catch { /* skip */ }
    }
  }
  return total;
}

function countFiles(p: string): number {
  let n = 0;
  const stack = [p];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const abs = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(abs);
      else if (e.isFile()) n++;
    }
  }
  return n;
}

// Wrapper LLM que cuenta tokens de entrada/salida (estimación rough: chars/4).
function makeCountingLLM(): { client: any; in: () => number; out: () => number } {
  const inner = makeLLMClient();
  let totalIn = 0, totalOut = 0;
  const client = {
    async chat(messages: any[], opts: any) {
      const promptChars = messages.map((m: any) => m.content || '').join('').length;
      totalIn += promptChars;
      const reply = await inner.chat(messages, opts);
      totalOut += String(reply || '').length;
      return reply;
    },
  };
  return { client, in: () => Math.round(totalIn / 4), out: () => Math.round(totalOut / 4) };
}

async function processOne(target: RepoTarget): Promise<RunRecord> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `s1_5_${target.name}_`));
  const repoDir = path.join(tmpRoot, target.name);
  console.log(`\n═══ [${target.name}] cloning ${target.url} ═══`);
  const t0 = Date.now();
  const clone = spawnSync('git', ['clone', '--depth', '1', target.url, repoDir], { encoding: 'utf-8', stdio: 'inherit' });
  const cloneDurationMs = Date.now() - t0;
  if (clone.status !== 0) {
    return {
      repo: target.name, url: target.url, cloneSha: '', cloneSizeBytes: 0,
      cloneDurationMs, totalFiles: 0, topLevelEntries: 0,
      readOk: false, readDurationMs: 0, subagentCount: 0,
      miscBranchPresent: false, filesCoveredApprox: 0, filesIgnoredApprox: 0,
      estimatedTokensIn: 0, estimatedTokensOut: 0,
      reportSummary: '', reportError: 'clone failed', missionDir: '',
    };
  }
  const sha = (spawnSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).stdout || '').trim().slice(0, 12);
  const totalFiles = countFiles(repoDir);
  const topLevelEntries = fs.readdirSync(repoDir).filter(n => n !== '.git').length;
  const sizeBytes = dirSize(repoDir);
  console.log(`[${target.name}] cloned in ${(cloneDurationMs/1000).toFixed(1)}s, sha=${sha}, top-level entries=${topLevelEntries}, total files=${totalFiles}, size=${(sizeBytes/1024/1024).toFixed(1)}MB`);

  // Ejecutar runRead via wrapper que mide tokens.
  const counting = makeCountingLLM();
  const { RepoReader, DEFAULT_BUDGET } = await import('../src/reader/RepoReader.js');
  const reader = new RepoReader({
    llm: counting.client,
    budget: DEFAULT_BUDGET,
    onProgress: (ev) => {
      if (ev.phase === 'subagent_done') console.log(`[${target.name}]   ✓ ${ev.detail}`);
      else if (ev.phase === 'partition' || ev.phase === 'spawn' || ev.phase === 'synthesize') console.log(`[${target.name}] ${ev.phase} ${ev.detail || ''}`);
    },
  });
  const t1 = Date.now();
  let result: any;
  let err: string | undefined;
  try {
    result = await reader.read(repoDir);
  } catch (e: any) {
    err = e?.message ?? String(e);
  }
  const readDurationMs = Date.now() - t1;

  const subreports = result?.subreports ?? [];
  const subagentCount = subreports.length;
  const miscBranch = subreports.find((s: any) => s.path === 'misc/');
  const miscBranchPresent = !!miscBranch;

  // Estimar archivos cubiertos: cada SubReport cubre los archivos que recibió
  // (no expuesto directo). Para una rough: contar key_files reportados.
  let filesCoveredApprox = 0;
  for (const s of subreports) {
    if (Array.isArray(s.key_files)) filesCoveredApprox += s.key_files.length;
  }
  const filesIgnoredApprox = totalFiles - filesCoveredApprox;

  let reportSummary = '';
  if (result?.ok && result.report) {
    reportSummary = (result.report.repo_purpose || '').slice(0, 240);
  } else {
    reportSummary = '(no report)';
    err = err || result?.error || 'unknown error';
  }

  // Persistir mission dir + log
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const missionDir = path.join(process.cwd(), 'missions', `${ts}_s1_5_${target.name}`);
  fs.mkdirSync(missionDir, { recursive: true });
  if (subreports.length) fs.writeFileSync(path.join(missionDir, 'subreports.json'), JSON.stringify(subreports, null, 2));
  if (result?.report) fs.writeFileSync(path.join(missionDir, 'report.json'), JSON.stringify(result.report, null, 2));
  fs.writeFileSync(path.join(missionDir, 'meta.json'), JSON.stringify({
    repo: target.name, url: target.url, sha, cloneSizeBytes: sizeBytes,
    cloneDurationMs, readDurationMs, totalFiles, topLevelEntries,
    subagentCount, miscBranchPresent, filesCoveredApprox, filesIgnoredApprox,
    estimatedTokensIn: counting.in(), estimatedTokensOut: counting.out(),
    error: err,
  }, null, 2));

  console.log(`[${target.name}] read ${result?.ok ? 'OK' : 'FAILED'} dur=${(readDurationMs/1000).toFixed(1)}s subagents=${subagentCount} tokens_in≈${counting.in()} tokens_out≈${counting.out()} misc=${miscBranchPresent}`);

  // Cleanup clone
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* tolerant */ }

  return {
    repo: target.name, url: target.url, cloneSha: sha, cloneSizeBytes: sizeBytes,
    cloneDurationMs, totalFiles, topLevelEntries,
    readOk: !!result?.ok, readDurationMs, subagentCount,
    miscBranchPresent, filesCoveredApprox, filesIgnoredApprox,
    estimatedTokensIn: counting.in(), estimatedTokensOut: counting.out(),
    reportSummary, reportError: err, missionDir,
  };
}

async function main() {
  console.log('═══ S1.5 reader stress test — 3 repos ═══');
  console.log('config: depth=1 (default runRead), no voting, OPENROUTER (haiku leaves + opus synth)');

  for (const target of REPOS) {
    try {
      const rec = await processOne(target);
      records.push(rec);
    } catch (e: any) {
      console.error(`[${target.name}] FATAL:`, e?.message ?? e);
      records.push({
        repo: target.name, url: target.url, cloneSha: '', cloneSizeBytes: 0,
        cloneDurationMs: 0, totalFiles: 0, topLevelEntries: 0,
        readOk: false, readDurationMs: 0, subagentCount: 0,
        miscBranchPresent: false, filesCoveredApprox: 0, filesIgnoredApprox: 0,
        estimatedTokensIn: 0, estimatedTokensOut: 0,
        reportSummary: '', reportError: e?.message ?? String(e), missionDir: '',
      });
    }
  }

  // Vuelca records JSON crudo + los printea
  const outJson = path.join(process.cwd(), 'docs', 's1_5', 'stress_records.json');
  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, JSON.stringify(records, null, 2));
  console.log(`\n[s1_5] records: ${outJson}`);
  console.log('\n=== SUMMARY ===');
  for (const r of records) {
    console.log(`${r.repo}: ${r.readOk ? 'OK' : 'ROTO'} dur=${(r.readDurationMs/1000).toFixed(1)}s subagents=${r.subagentCount} files_seen=${r.filesCoveredApprox}/${r.totalFiles} tokens≈${r.estimatedTokensIn+r.estimatedTokensOut} ${r.reportError ? '— err: ' + r.reportError : ''}`);
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
