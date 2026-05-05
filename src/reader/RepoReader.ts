// Habilidad A — RepoReader: orquesta partición → spawn → synthesize.
// Contrato: docs/ARQUITECTURA_HABILIDAD_A.md.

import * as fs from 'fs';
import * as path from 'path';
import {
  RepoReport,
  validateRepoReport,
  tryParseJSON,
} from './schemas.js';
import {
  LLMClient,
  SubAgentOptions,
  SubTask,
  runSubAgent,
} from './SubAgent.js';
import type { SubReport, SubReportError } from './schemas.js';

export interface Budget {
  maxSubagents: number;
  tokensTotal: number;
  perSubagentTimeoutMs: number;
  totalTimeoutMs: number;
}

export const DEFAULT_BUDGET: Budget = {
  maxSubagents: 6,
  tokensTotal: 50_000,
  perSubagentTimeoutMs: 90_000,
  totalTimeoutMs: 180_000,
};

export const READER_IGNORE_PATTERNS = new Set<string>([
  'node_modules', 'dist', 'build', '.git', '.venv', '__pycache__',
  '.next', 'coverage', '.cache', '.idea', '.vscode',
]);

const IGNORE_FILE_EXT = new Set<string>([
  '.log', '.lock', '.tmp', '.exe', '.dll', '.png', '.jpg', '.jpeg',
  '.gif', '.pdf', '.zip', '.tar', '.gz', '.7z', '.mp4', '.mp3',
]);

const ROOT_META_FILES = new Set<string>([
  'README.md', 'README', 'package.json', 'tsconfig.json', 'pyproject.toml',
  'requirements.txt', 'Cargo.toml', 'go.mod', '.env.example',
  'LICENSE', 'LICENSE.md',
]);

interface DirEntry { name: string; abs: string; isDir: boolean; size: number }

function listDirSafe(p: string): DirEntry[] {
  try {
    return fs.readdirSync(p, { withFileTypes: true })
      .filter((d) => !READER_IGNORE_PATTERNS.has(d.name))
      .map((d) => {
        const abs = path.join(p, d.name);
        let size = 0;
        try { size = d.isFile() ? fs.statSync(abs).size : 0; } catch { /* ignore */ }
        return { name: d.name, abs, isDir: d.isDirectory(), size };
      });
  } catch {
    return [];
  }
}

function isSourceFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  if (IGNORE_FILE_EXT.has(ext)) return false;
  return true;
}

function countFilesRecursive(dirAbs: string, cap = 200): number {
  let n = 0;
  const stack = [dirAbs];
  while (stack.length && n < cap) {
    const cur = stack.pop()!;
    for (const e of listDirSafe(cur)) {
      if (e.isDir) stack.push(e.abs);
      else if (isSourceFile(e.name)) n++;
      if (n >= cap) break;
    }
  }
  return n;
}

function gatherFiles(dirAbs: string, cap: number): string[] {
  const files: string[] = [];
  const stack = [dirAbs];
  while (stack.length && files.length < cap) {
    const cur = stack.pop()!;
    for (const e of listDirSafe(cur)) {
      if (files.length >= cap) break;
      if (e.isDir) stack.push(e.abs);
      else if (isSourceFile(e.name)) files.push(e.abs);
    }
  }
  // Prioritize index/README/package.json first if present
  files.sort((a, b) => {
    const sa = scoreFilename(path.basename(a));
    const sb = scoreFilename(path.basename(b));
    return sb - sa;
  });
  return files;
}

function scoreFilename(name: string): number {
  if (/^README/i.test(name)) return 10;
  if (/^index\./i.test(name)) return 9;
  if (/^package\.json$/i.test(name)) return 8;
  if (/^main\./i.test(name)) return 7;
  return 0;
}

export interface PartitionResult {
  rootMeta: SubTask;
  branches: SubTask[];
}

export function partition(repoAbs: string, budget: Budget = DEFAULT_BUDGET): PartitionResult {
  const top = listDirSafe(repoAbs);
  const dirs = top.filter((e) => e.isDir);
  const rootFiles = top.filter((e) => !e.isDir && isSourceFile(e.name));

  // root_meta: all top-level meta files + any README inside repo
  const rootMetaFiles: string[] = rootFiles
    .filter((f) => ROOT_META_FILES.has(f.name) || /^README/i.test(f.name))
    .map((f) => f.abs);

  // Score directories by file count (rough proxy for "weight").
  const ranked = dirs.map((d) => ({ ...d, files: countFilesRecursive(d.abs) }))
    .sort((a, b) => b.files - a.files);

  const maxBranches = Math.max(1, budget.maxSubagents - 1); // keep one slot for root_meta
  const heavy = ranked.slice(0, maxBranches - 1);
  const tail = ranked.slice(maxBranches - 1);

  const tokensPerSub = Math.floor(budget.tokensTotal / budget.maxSubagents);
  const filesCap = Math.max(4, Math.floor(tokensPerSub / 1500)); // ~1.5k tokens/file rough budget

  const branches: SubTask[] = heavy.map((d) => ({
    sub_path: path.relative(repoAbs, d.abs).replace(/\\/g, '/'),
    abs_path: d.abs,
    files_to_read: gatherFiles(d.abs, filesCap),
    token_budget: tokensPerSub,
  }));

  if (tail.length > 0) {
    // Group small folders into one "misc" sub-agent
    const miscFiles: string[] = [];
    for (const d of tail) {
      const more = gatherFiles(d.abs, Math.max(2, Math.floor(filesCap / tail.length)));
      for (const f of more) {
        if (miscFiles.length >= filesCap) break;
        miscFiles.push(f);
      }
    }
    branches.push({
      sub_path: 'misc/',
      abs_path: repoAbs,
      files_to_read: miscFiles,
      prompt_extra: `Aggregate report across these small folders: ${tail.map((t) => t.name).join(', ')}`,
      token_budget: tokensPerSub,
    });
  }

  const rootMeta: SubTask = {
    sub_path: '/',
    abs_path: repoAbs,
    files_to_read: rootMetaFiles,
    prompt_extra: 'This is the root_meta task. Focus on overall purpose, license, entry points, build setup.',
    token_budget: tokensPerSub,
  };

  return { rootMeta, branches };
}

const SYNTH_SYSTEM = `You are a senior architect synthesizing a single repo report from N sub-reports.
Return ONE JSON object matching this exact schema (no prose, no markdown fence):

{
  "repo_purpose": string (max 300),
  "architecture_summary": string (max 1500, markdown allowed),
  "modules": [{"name": string, "path": string, "responsibility": string (max 200)}],
  "entry_points": [{"file": string, "kind": string}],
  "risks": [{"severity": "low"|"medium"|"high", "description": string (max 200)}],
  "evidence": {"subagent_count": number, "tokens_total": number, "duration_ms": number, "subreports_referenced": number}
}

Rules:
- Detect contradictions between sub-reports and surface them as risks (severity medium or high).
- If a sub-report has "[unreadable]", mention it as a risk severity medium.
- Do NOT invent files or modules that no sub-report mentioned.
- Output JSON only.`;

export interface ReadResult {
  ok: true;
  report: RepoReport;
  subreports: (SubReport | SubReportError)[];
  meta: { duration_ms: number; subagent_count: number };
}
export interface ReadFailure {
  ok: false;
  error: string;
  subreports: (SubReport | SubReportError)[];
}

export interface RepoReaderOptions {
  llm: LLMClient;
  budget?: Budget;
  subagentModel?: string;     // default haiku
  synthModel?: string;        // default opus
  onProgress?: (ev: { phase: string; detail?: string }) => void;
}

export class RepoReader {
  private llm: LLMClient;
  private budget: Budget;
  private subagentModel: string;
  private synthModel: string;
  private onProgress: NonNullable<RepoReaderOptions['onProgress']>;

  constructor(opts: RepoReaderOptions) {
    this.llm = opts.llm;
    this.budget = opts.budget ?? DEFAULT_BUDGET;
    this.subagentModel = opts.subagentModel ?? 'claude-haiku-4-5';
    this.synthModel = opts.synthModel ?? 'claude-opus-4-7';
    this.onProgress = opts.onProgress ?? (() => {});
  }

  async read(repoAbs: string): Promise<ReadResult | ReadFailure> {
    const t0 = Date.now();
    if (!fs.existsSync(repoAbs)) {
      return { ok: false, error: `path does not exist: ${repoAbs}`, subreports: [] };
    }

    this.onProgress({ phase: 'partition', detail: repoAbs });
    const { rootMeta, branches } = partition(repoAbs, this.budget);
    const allTasks = [rootMeta, ...branches];
    this.onProgress({ phase: 'spawn', detail: `${allTasks.length} sub-agents` });

    const subOpts: SubAgentOptions = { model: this.subagentModel };
    const settled = await Promise.all(
      allTasks.map((t) =>
        withTimeout(runSubAgent(t, this.llm, subOpts), this.budget.perSubagentTimeoutMs)
          .then((r) => {
            this.onProgress({ phase: 'subagent_done', detail: t.sub_path });
            return r as SubReport | SubReportError;
          })
          .catch((e) => ({
            path: t.sub_path,
            purpose: '[unreadable]' as const,
            error: e?.message ?? String(e),
          })),
      ),
    );

    this.onProgress({ phase: 'synthesize' });
    const synthResult = await this.synthesize(settled, allTasks.length, Date.now() - t0);

    if (!synthResult.ok) {
      return { ok: false, error: synthResult.error, subreports: settled };
    }

    return {
      ok: true,
      report: synthResult.value,
      subreports: settled,
      meta: { duration_ms: Date.now() - t0, subagent_count: allTasks.length },
    };
  }

  async synthesize(
    subreports: (SubReport | SubReportError)[],
    subagentCount: number,
    durationSoFarMs: number,
  ): Promise<{ ok: true; value: RepoReport } | { ok: false; error: string }> {
    const userPrompt =
      `Sub-reports (JSON array):\n` +
      JSON.stringify(subreports, null, 2) +
      `\n\nMetadata to embed verbatim in evidence:\n` +
      JSON.stringify({
        subagent_count: subagentCount,
        tokens_total: 0,
        duration_ms: durationSoFarMs,
        subreports_referenced: subreports.length,
      });

    const callOnce = async (extra = ''): Promise<unknown> => {
      const raw = await this.llm.chat(
        [
          { role: 'system', content: SYNTH_SYSTEM + (extra ? `\n\n${extra}` : '') },
          { role: 'user', content: userPrompt },
        ],
        { model: this.synthModel },
      );
      return tryParseJSON(raw);
    };

    let parsed: unknown;
    try { parsed = await callOnce(); }
    catch (e: any) { return { ok: false, error: `synth call failed: ${e?.message ?? e}` }; }

    let v = validateRepoReport(parsed);
    if (v.ok) return { ok: true, value: v.value };

    try {
      parsed = await callOnce(
        `Your previous response failed validation: ${v.error}. Return strictly valid JSON now.`,
      );
    } catch (e: any) {
      return { ok: false, error: `synth retry call failed: ${e?.message ?? e}` };
    }
    v = validateRepoReport(parsed);
    if (v.ok) return { ok: true, value: v.value };
    return { ok: false, error: `synth validation failed twice: ${v.error}` };
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
