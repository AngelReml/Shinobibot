// Habilidad D.2 — HierarchicalReader: extiende RepoReader con depth jerárquico.
// depth=1 → behavior de Habilidad A (plano, 1 supervisor + N sub-agentes hoja).
// depth=2 → 1 supervisor + M sub-supervisores temáticos, cada sub-sup parte
//           SU subrama y despliega K hojas.
// depth=3 → reservado, mismo patrón recursivo. No se construye en este gate.
//
// Cada nodo del árbol logguea inicio/fin/coste/output → telemetría visualizable.
// IMPORTANTE: NO modifica RepoReader (gate A.4 ya verde). Construido al lado.

import * as fs from 'fs';
import * as path from 'path';
import {
  partition,
  DEFAULT_BUDGET,
  type Budget,
  type PartitionResult,
} from './RepoReader.js';
import { runSubAgent, type LLMClient, type SubTask } from './SubAgent.js';
import {
  validateRepoReport,
  tryParseJSON,
  type RepoReport,
  type SubReport,
  type SubReportError,
} from './schemas.js';

export type Depth = 1 | 2 | 3;

export interface TelemetryNode {
  id: string;                   // unique within tree, dot-separated path "0.2.1"
  level: 'supervisor' | 'sub_supervisor' | 'leaf';
  label: string;                // sub_path / "root"
  start_ms: number;             // ms since reader start
  end_ms?: number;
  duration_ms?: number;
  status: 'running' | 'ok' | 'error';
  error?: string;
  children: TelemetryNode[];
  payload?: { type: 'sub_report' | 'sub_synth' | 'final_synth'; size_chars: number };
}

export interface HierarchicalResult {
  ok: boolean;
  report?: RepoReport;
  subreports: (SubReport | SubReportError)[];
  telemetry: TelemetryNode;
  duration_ms: number;
  error?: string;
}

export interface HierarchicalOptions {
  llm: LLMClient;
  depth?: Depth;                 // default 1 (= behavior of Habilidad A)
  budget?: Budget;
  subagentModel?: string;
  synthModel?: string;
  onProgress?: (ev: { phase: string; node?: TelemetryNode }) => void;
  knowledgeInjector?: (task: string) => string;
  missionId?: string;
}

const SYNTH_SYSTEM_FINAL = `You are a senior software architect synthesizing N parallel sub-reports into a single repository overview. The sub-reports may be either leaf-level (one folder each) OR branch-level (a sub-supervisor that already consolidated its own leaves) — treat both the same way: every fact you emit must trace back to one of them.

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
- Detect contradictions between sub-reports and surface them as risks (severity medium/high) with a one-line description naming the conflicting reports.
- If a sub-report has "[unreadable]", mention it as a risk severity medium ("module X not read — gap").
- If a sub-report has "[degraded-empty]" (F-01: visible files but no extraction), mention it as a risk severity low ("module X read but extraction empty — verify manually").
- Do NOT invent files, modules, or entry_points that no sub-report mentioned.
- Branch-level sub-reports describe a folder's role; do not collapse multiple branches into one module unless they truly are one module split across folders.
- Use the literal "path" from sub-reports for modules[].path. Do not normalize, prettify, or shorten.
- Each risks[].description MUST be ≤200 chars. If you need more detail, split into two adjacent risks rather than overflowing one.
- Output JSON only.

Acceptable risk: "[HIGH] Two sub-reports disagree on license: src/ says ISC, root says MIT." (concrete, traces to inputs).
Unacceptable risk: "[MEDIUM] Code quality could be improved." (vague, untraceable).

Self-check before emitting: every modules[].path must equal a path from at least one input sub-report (whether leaf or branch). Cascade is allowed; invention is not. Every risks[].description must be ≤200 chars — count before emitting.`;

const SYNTH_SYSTEM_INTERMEDIATE = `You are a sub-supervisor consolidating leaf sub-reports into a single SubReport for ONE branch of a repository. The branch is a folder (e.g. "src/audit") whose children were each read by their own leaf worker. Your job is aggregation — you do NOT read code yourself.

Return ONE JSON object matching the SubReport schema, treating this branch as a single folder:
{
  "path": string,                                            // the branch path, copied verbatim
  "purpose": string (max 200),                              // what THIS branch does as a whole
  "key_files": [{"name": string, "role": string (max 100)}], // max 8, picked from leaves
  "dependencies": {"internal": string[], "external": string[]},
  "concerns": string[]                                       // max 5, each <=150 chars
}

Rules:
- Aggregate the leaves you receive. Do NOT invent new files, paths, or dependencies that no leaf mentioned.
- "purpose" describes the BRANCH, not any single leaf. Avoid copy-pasting a leaf's purpose verbatim — abstract one level up.
- "key_files" must be picked from the leaves' key_files; pick the most representative 8 max, prefer files that appear in multiple leaves' contexts (entry points, configs, indices).
- "dependencies" union the leaves' dependencies, deduplicated.
- "concerns" carry forward only the concerns that affect the branch as a whole. Drop leaf-specific concerns ("TODO at line 42 of foo.ts") in favor of branch-wide ones ("no test coverage in any leaf").
- Output JSON only.

Acceptable purpose: "Hierarchical reading swarm — leaf SubAgent + supervisor RepoReader + depth=2 HierarchicalReader." (abstraction at branch level).
Unacceptable purpose: "Files for the reader." (no information).

Self-check: every key_files[].name must appear in at least one leaf's key_files. Every external dep must appear in at least one leaf's dependencies.external. If you can't trace it, drop it.`;


function nowMs(start: number): number { return Date.now() - start; }

function leafSubReportToString(r: SubReport | SubReportError): string {
  return JSON.stringify(r);
}

async function callJSON(llm: LLMClient, system: string, user: string, model: string): Promise<unknown> {
  const raw = await llm.chat(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { model },
  );
  return tryParseJSON(raw);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function buildSubBudget(parent: Budget, children: number): Budget {
  // Hard cap at parent level. Each child gets a proportional sub-budget so the
  // total never exceeds the parent. R3 mitigation from plan §8.1.
  const tokensTotal = Math.max(8_000, Math.floor(parent.tokensTotal / Math.max(1, children)));
  return {
    ...parent,
    tokensTotal,
    maxSubagents: Math.max(2, Math.min(parent.maxSubagents, Math.floor(tokensTotal / 8_000))),
  };
}

export class HierarchicalReader {
  private llm: LLMClient;
  private depth: Depth;
  private budget: Budget;
  private subagentModel: string;
  private synthModel: string;
  private onProgress: NonNullable<HierarchicalOptions['onProgress']>;
  private knowledgeInjector?: (t: string) => string;
  private missionId: string;

  constructor(opts: HierarchicalOptions) {
    this.llm = opts.llm;
    this.depth = opts.depth ?? 1;
    this.budget = opts.budget ?? DEFAULT_BUDGET;
    this.subagentModel = opts.subagentModel ?? 'z-ai/glm-4.7-flash';
    this.synthModel = opts.synthModel ?? 'claude-sonnet-4-6';
    this.onProgress = opts.onProgress ?? (() => {});
    this.knowledgeInjector = opts.knowledgeInjector;
    this.missionId = opts.missionId ?? 'unknown';
  }

  async read(repoAbs: string): Promise<HierarchicalResult> {
    const start = Date.now();
    if (!fs.existsSync(repoAbs)) {
      return {
        ok: false,
        subreports: [],
        telemetry: { id: '0', level: 'supervisor', label: 'root', start_ms: 0, status: 'error', children: [], error: `path missing: ${repoAbs}` },
        duration_ms: 0,
        error: `path missing: ${repoAbs}`,
      };
    }

    const supervisor: TelemetryNode = {
      id: '0',
      level: 'supervisor',
      label: 'root',
      start_ms: 0,
      status: 'running',
      children: [],
    };
    this.onProgress({ phase: 'supervisor_start', node: supervisor });

    const partitionTop = partition(repoAbs, this.budget);
    const topTasks: SubTask[] = [partitionTop.rootMeta, ...partitionTop.branches];

    let subreports: (SubReport | SubReportError)[];
    try {
      if (this.depth === 1) {
        subreports = await this.executeLeaves(topTasks, supervisor, start);
      } else {
        subreports = await this.executeWithSubSupervisors(topTasks, supervisor, start, repoAbs);
      }
    } catch (e: any) {
      supervisor.status = 'error';
      supervisor.end_ms = nowMs(start);
      supervisor.error = e?.message ?? String(e);
      return { ok: false, subreports: [], telemetry: supervisor, duration_ms: Date.now() - start, error: supervisor.error };
    }

    // Final synthesis at root
    this.onProgress({ phase: 'final_synth_start' });
    const synthUser =
      `Sub-reports (JSON array):\n` + JSON.stringify(subreports, null, 2) +
      `\n\nMetadata to embed verbatim in evidence:\n` +
      JSON.stringify({
        subagent_count: topTasks.length,
        tokens_total: 0,
        duration_ms: Date.now() - start,
        subreports_referenced: subreports.length,
      });

    let synth: unknown;
    try {
      synth = await callJSON(this.llm, SYNTH_SYSTEM_FINAL, synthUser, this.synthModel);
    } catch (e: any) {
      supervisor.status = 'error';
      supervisor.end_ms = nowMs(start);
      supervisor.error = `final synth failed: ${e?.message ?? e}`;
      return { ok: false, subreports, telemetry: supervisor, duration_ms: Date.now() - start, error: supervisor.error };
    }
    let v = validateRepoReport(synth);
    if (!v.ok) {
      // retry once
      try {
        synth = await callJSON(this.llm, SYNTH_SYSTEM_FINAL + `\n\nYour previous response failed validation: ${v.error}.`, synthUser, this.synthModel);
      } catch (e: any) {
        supervisor.status = 'error';
        supervisor.end_ms = nowMs(start);
        supervisor.error = `final synth retry failed: ${e?.message ?? e}`;
        return { ok: false, subreports, telemetry: supervisor, duration_ms: Date.now() - start, error: supervisor.error };
      }
      v = validateRepoReport(synth);
      if (!v.ok) {
        supervisor.status = 'error';
        supervisor.end_ms = nowMs(start);
        supervisor.error = `final synth invalid twice: ${v.error}`;
        return { ok: false, subreports, telemetry: supervisor, duration_ms: Date.now() - start, error: supervisor.error };
      }
    }

    supervisor.status = 'ok';
    supervisor.end_ms = nowMs(start);
    supervisor.duration_ms = supervisor.end_ms - supervisor.start_ms;
    const synthStr = JSON.stringify(v.value);
    supervisor.payload = { type: 'final_synth', size_chars: synthStr.length };
    this.onProgress({ phase: 'final_synth_done', node: supervisor });

    return {
      ok: true,
      report: v.value,
      subreports,
      telemetry: supervisor,
      duration_ms: Date.now() - start,
    };
  }

  private async executeLeaves(tasks: SubTask[], parent: TelemetryNode, start: number): Promise<(SubReport | SubReportError)[]> {
    const results = await Promise.all(tasks.map((t, i) => this.runLeaf(t, parent, start, i)));
    return results;
  }

  private async runLeaf(task: SubTask, parent: TelemetryNode, start: number, idx: number): Promise<SubReport | SubReportError> {
    const node: TelemetryNode = {
      id: `${parent.id}.${idx}`,
      level: 'leaf',
      label: task.sub_path,
      start_ms: nowMs(start),
      status: 'running',
      children: [],
    };
    parent.children.push(node);
    this.onProgress({ phase: 'leaf_start', node });

    const r = await withTimeout(
      runSubAgent(task, this.llm, {
        model: this.subagentModel,
        knowledgeInjector: this.knowledgeInjector,
        missionId: this.missionId,
      }),
      this.budget.perSubagentTimeoutMs,
    ).catch((e): SubReportError => ({
      path: task.sub_path,
      purpose: '[unreadable]',
      error: e?.message ?? String(e),
    }));

    node.status = ('error' in r) ? 'error' : 'ok';
    if ('error' in r) node.error = r.error;
    node.end_ms = nowMs(start);
    node.duration_ms = node.end_ms - node.start_ms;
    node.payload = { type: 'sub_report', size_chars: leafSubReportToString(r).length };
    this.onProgress({ phase: 'leaf_done', node });

    return r;
  }

  private async executeWithSubSupervisors(
    topTasks: SubTask[],
    supervisor: TelemetryNode,
    start: number,
    repoAbs: string,
  ): Promise<(SubReport | SubReportError)[]> {
    // For depth=2 each non-trivial top-level branch becomes a sub-supervisor
    // that repartitions its sub-tree. The "rootMeta" task stays a leaf
    // (single file group), and "misc/" stays a leaf.
    const results: (SubReport | SubReportError)[] = [];
    const subBudget = buildSubBudget(this.budget, topTasks.length);

    const promises = topTasks.map(async (t, idx) => {
      const isPromotable = t.sub_path !== '/' && t.sub_path !== 'misc/' && fs.existsSync(t.abs_path) && fs.statSync(t.abs_path).isDirectory();
      if (!isPromotable) {
        return this.runLeaf(t, supervisor, start, idx);
      }
      return this.runSubSupervisor(t, supervisor, start, idx, subBudget);
    });

    const all = await Promise.all(promises);
    for (const r of all) results.push(r);
    return results;
  }

  private async runSubSupervisor(
    branchTask: SubTask,
    parent: TelemetryNode,
    start: number,
    idx: number,
    budget: Budget,
  ): Promise<SubReport | SubReportError> {
    const node: TelemetryNode = {
      id: `${parent.id}.${idx}`,
      level: 'sub_supervisor',
      label: branchTask.sub_path,
      start_ms: nowMs(start),
      status: 'running',
      children: [],
    };
    parent.children.push(node);
    this.onProgress({ phase: 'sub_supervisor_start', node });

    // Re-partition this branch as its own root using the existing partitioner.
    const sub = partition(branchTask.abs_path, budget);
    const subTasks = [sub.rootMeta, ...sub.branches];
    const leafReports = await this.executeLeaves(subTasks, node, start);

    // Intermediate synth: aggregate leaf reports into ONE SubReport for the branch.
    const intermediateUser = `Branch path: ${branchTask.sub_path}\nLeaf sub-reports (JSON array):\n${JSON.stringify(leafReports, null, 2)}`;
    let consolidated: any;
    try {
      consolidated = await callJSON(this.llm, SYNTH_SYSTEM_INTERMEDIATE, intermediateUser, this.synthModel);
    } catch (e: any) {
      node.status = 'error';
      node.end_ms = nowMs(start);
      node.error = `intermediate synth failed: ${e?.message ?? e}`;
      this.onProgress({ phase: 'sub_supervisor_done', node });
      return { path: branchTask.sub_path, purpose: '[unreadable]', error: node.error };
    }

    if (
      !consolidated || typeof consolidated !== 'object' ||
      typeof (consolidated as any).path !== 'string' ||
      typeof (consolidated as any).purpose !== 'string'
    ) {
      node.status = 'error';
      node.end_ms = nowMs(start);
      node.error = 'intermediate synth invalid SubReport';
      this.onProgress({ phase: 'sub_supervisor_done', node });
      return { path: branchTask.sub_path, purpose: '[unreadable]', error: node.error };
    }

    // Force the path to the actual branch path (defensive).
    (consolidated as any).path = branchTask.sub_path;

    node.status = 'ok';
    node.end_ms = nowMs(start);
    node.duration_ms = node.end_ms - node.start_ms;
    node.payload = { type: 'sub_synth', size_chars: JSON.stringify(consolidated).length };
    this.onProgress({ phase: 'sub_supervisor_done', node });
    return consolidated as SubReport;
  }
}

// ── Telemetry rendering ────────────────────────────────────────────────────

export function renderTelemetryTree(root: TelemetryNode, opts: { showCharSizes?: boolean } = {}): string {
  const lines: string[] = [];
  // Root: no prefix, no connector.
  pushLine(root, '', '', lines, opts.showCharSizes ?? true);
  root.children.forEach((c, i) =>
    walk(c, '', i === root.children.length - 1, lines, opts.showCharSizes ?? true),
  );
  return lines.join('\n');
}

function pushLine(node: TelemetryNode, prefix: string, connector: string, out: string[], showSize: boolean) {
  const status = node.status === 'ok' ? '✓' : node.status === 'error' ? '✗' : '·';
  const dur = node.duration_ms !== undefined ? `${node.duration_ms}ms` : 'running';
  const lvl = node.level.padEnd(15);
  const sizePart = showSize && node.payload ? `  (${node.payload.size_chars} chars)` : '';
  const errPart = node.error ? `  err=${node.error}` : '';
  out.push(`${prefix}${connector}[${status}] ${lvl} ${node.label}  ${dur}${sizePart}${errPart}`);
}

function walk(node: TelemetryNode, prefix: string, isLast: boolean, out: string[], showSize: boolean) {
  const connector = isLast ? '└─ ' : '├─ ';
  pushLine(node, prefix, connector, out, showSize);
  const childPrefix = prefix + (isLast ? '   ' : '│  ');
  node.children.forEach((c, i) => walk(c, childPrefix, i === node.children.length - 1, out, showSize));
}
