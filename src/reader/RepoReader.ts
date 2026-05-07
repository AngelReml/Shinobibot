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

// F-04 — scoring estructural sobre el filecount.
// Promueve directorios donde vive el código real (cmd/, pkg/, libs/, packages/...)
// sobre fixtures, tests, vendor o builds. Detecta también la presencia de un
// manifest de módulo (package.json, pyproject.toml, etc.) como bonus de
// "ciudadanía estructural".
const STRUCTURAL_NAMES = new Set([
  'src', 'lib', 'libs', 'core', 'app', 'server', 'cmd', 'api',
  'internal', 'packages', 'pkg', 'staging', 'cli', 'compiler',
  'engine', 'runtime', 'kernel',
]);
const FIXTURE_LIKE_NAMES = new Set([
  'fixture', 'fixtures', 'test', 'tests', '__tests__', 'example',
  'examples', 'demo', 'demos', 'sandbox', 'sandboxes', 'playground',
  'benchmark', 'benchmarks', 'spec', 'specs', 'mocks', '__mocks__',
  'testdata', 'test-data', 'e2e',
]);
const HEAVY_PENALTY_NAMES = new Set([
  'vendor', 'vendored', 'third_party', 'thirdparty', 'node_modules',
  'dist', 'build', 'target', 'out', 'coverage', '_build', '.cache',
]);
const MODULE_MANIFEST_FILES = [
  'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml',
  'Gemfile', 'composer.json', 'mix.exs', 'build.gradle', 'CMakeLists.txt',
];

export function scoreDirectory(absPath: string, name: string, fileCount: number): number {
  let s = Math.min(fileCount, 200);
  const lower = name.toLowerCase();
  if (STRUCTURAL_NAMES.has(lower)) s += 80;
  if (FIXTURE_LIKE_NAMES.has(lower)) s -= 100;
  if (HEAVY_PENALTY_NAMES.has(lower)) s -= 200;
  // Manifest de módulo en la raíz del directorio: bonus.
  for (const m of MODULE_MANIFEST_FILES) {
    try {
      if (fs.existsSync(path.join(absPath, m))) { s += 50; break; }
    } catch { /* ignore */ }
  }
  return s;
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

  // F-04 — Score directories combinando filecount con relevancia estructural.
  // (Antes: sólo filecount → fixtures grandes ganaban a módulos core pequeños.)
  const ranked = dirs.map((d) => {
      const files = countFilesRecursive(d.abs);
      return { ...d, files, score: scoreDirectory(d.abs, d.name, files) };
    })
    .sort((a, b) => b.score - a.score);

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

const SYNTH_SYSTEM = `You are a senior software architect synthesizing N parallel folder reports into a single repository overview. You have NOT read the code yourself — every fact must trace back to one of the sub-reports below. Your job is to detect agreements, contradictions, and gaps.

Return ONE JSON object matching this exact schema (no prose, no fence):
{
  "repo_purpose": string (max 300),
  "architecture_summary": string (max 1500, markdown allowed),
  "modules": [{"name": string, "path": string, "responsibility": string (max 200)}],
  "entry_points": [{"file": string, "kind": string}],
  "risks": [{"severity": "low"|"medium"|"high", "description": string (max 200, split into multiple risks if you need more detail)}],
  "evidence": {"subagent_count": number, "tokens_total": number, "duration_ms": number, "subreports_referenced": number}
}

Rules:
- Detect contradictions between sub-reports and surface them as risks (severity medium or high) with a one-line description naming the conflicting reports.
- If a sub-report has "[unreadable]", mention it as a risk severity medium ("module X not read — gap").
- Do NOT invent files, modules, or entry_points that no sub-report mentioned. If a path appears nowhere in the sub-reports, do not put it in the output.
- Use the literal "path" from sub-reports for modules[].path. Do not normalize, prettify, or shorten.
- Each risks[].description MUST be ≤200 chars. If you need more detail, split into two adjacent risks rather than overflowing one.
- Output JSON only.

Acceptable risk example: "[HIGH] Two sub-reports disagree on license: src/ says ISC, root says MIT." (concrete, traces to sub-reports).
Unacceptable risk example: "[MEDIUM] Code quality could be improved." (vague, untraceable, speculative).

Self-check before emitting: every modules[].path and every entry_points[].file must appear literally in at least one sub-report's path or key_files[].name. If you can't trace it, drop it. Every risks[].description must be ≤200 chars — count before emitting.`;

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
    this.subagentModel = opts.subagentModel ?? 'z-ai/glm-4.7-flash';
    this.synthModel = opts.synthModel ?? 'claude-sonnet-4-6';
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
