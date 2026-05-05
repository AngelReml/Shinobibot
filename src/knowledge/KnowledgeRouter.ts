// Habilidad C.2 — KnowledgeRouter
// Detecta menciones de programas aprendidos en una tarea, inyecta contexto
// del manual relevante (max ~4k tokens, priorizando secciones aplicables a la
// tarea) y registra qué manuales se usaron en knowledge/usage.log.

import * as fs from 'fs';
import * as path from 'path';
import type { Manual } from './learn.js';

export interface RoutedManualSlice {
  program: string;
  source: string;             // origin URL or repo path
  injected_text: string;      // ready to splice into a sub-agent prompt
  injected_chars: number;
  matched_terms: string[];
}

export interface RouteResult {
  detected: string[];                      // program names detected in task
  injected: RoutedManualSlice[];           // ordered, capped at maxTokens combined
  skipped: string[];                       // programs detected but skipped (cap, missing manual)
}

const ROUGH_CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_TOKENS = 4_000;

export interface RouterOptions {
  knowledgeDir?: string;
  maxTokens?: number;            // total across all injected manuals
  usageLogPath?: string;
  /** When two programs share a synonym, prefer the program with more matches. */
}

interface LoadedManual { name: string; manual: Manual }

function listManuals(knowledgeDir: string): LoadedManual[] {
  if (!fs.existsSync(knowledgeDir)) return [];
  const out: LoadedManual[] = [];
  for (const name of fs.readdirSync(knowledgeDir)) {
    const p = path.join(knowledgeDir, name, 'manual.json');
    if (!fs.existsSync(p)) continue;
    try {
      const manual = JSON.parse(fs.readFileSync(p, 'utf-8')) as Manual;
      out.push({ name, manual });
    } catch { /* skip malformed */ }
  }
  return out;
}

function makeNeedles(name: string, manual: Manual): string[] {
  const set = new Set<string>([name.toLowerCase()]);
  for (const s of manual.synonyms ?? []) set.add(s.toLowerCase());
  return [...set].filter((s) => s.length >= 2);
}

function countWordMatches(haystack: string, needle: string): number {
  // Word-boundary, case-insensitive. Escape regex meta chars in needle.
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, 'gi');
  let n = 0;
  while (re.exec(haystack) !== null) n++;
  return n;
}

interface Section { title: string; body: string; relevance: number }

function manualSections(manual: Manual): Section[] {
  const out: Section[] = [];
  out.push({ title: 'purpose', body: manual.purpose, relevance: 0 });
  out.push({ title: 'install', body: manual.install, relevance: 0 });
  for (const e of manual.public_api) {
    out.push({ title: `api: ${e.name}`, body: `${e.signature}\n${e.summary}`, relevance: 0 });
  }
  for (const u of manual.usage_patterns) {
    out.push({ title: `pattern: ${u.title}`, body: u.body, relevance: 0 });
  }
  if (manual.gotchas.length > 0) {
    out.push({ title: 'gotchas', body: manual.gotchas.map((g) => `- ${g}`).join('\n'), relevance: 0 });
  }
  for (const ex of manual.examples) {
    out.push({ title: `example: ${ex.title}`, body: ex.code, relevance: 0 });
  }
  return out;
}

function scoreSectionsAgainstTask(secs: Section[], task: string): Section[] {
  const taskLow = task.toLowerCase();
  const taskWords = new Set(taskLow.split(/[^a-z0-9_]+/g).filter((w) => w.length >= 4));
  for (const s of secs) {
    const blob = (s.title + '\n' + s.body).toLowerCase();
    let score = 0;
    for (const w of taskWords) if (blob.includes(w)) score++;
    // Mandatory sections get a small floor so they always show up.
    if (s.title === 'purpose' || s.title === 'install') score += 0.5;
    s.relevance = score;
  }
  return secs;
}

function buildSlice(programName: string, manual: Manual, task: string, charBudget: number): { text: string; chars: number } {
  const sections = scoreSectionsAgainstTask(manualSections(manual), task)
    .sort((a, b) => b.relevance - a.relevance);

  const lines: string[] = [`### Manual injected: ${programName}`, `(source: ${manual.source.kind} ${manual.source.origin})`, ''];
  let chars = lines.join('\n').length;
  for (const s of sections) {
    const block = `**${s.title}**\n${s.body}\n`;
    if (chars + block.length > charBudget) break;
    lines.push(block);
    chars += block.length;
  }
  const text = lines.join('\n');
  return { text, chars: text.length };
}

function appendUsageLog(logPath: string, missionId: string, used: RoutedManualSlice[]): void {
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const lines = used.map((u) => JSON.stringify({
    ts: new Date().toISOString(),
    mission_id: missionId,
    program: u.program,
    source: u.source,
    matched_terms: u.matched_terms,
    injected_chars: u.injected_chars,
  }));
  fs.appendFileSync(logPath, lines.join('\n') + (lines.length ? '\n' : ''));
}

export class KnowledgeRouter {
  private knowledgeDir: string;
  private maxTokens: number;
  private usageLogPath: string;

  constructor(opts: RouterOptions = {}) {
    this.knowledgeDir = opts.knowledgeDir ?? path.join(process.cwd(), 'knowledge');
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.usageLogPath = opts.usageLogPath ?? path.join(process.cwd(), 'knowledge', 'usage.log');
  }

  /**
   * Scan a task string and return manuals to inject. Order: highest match count first.
   * Total injected_chars across the result is capped at maxTokens * 4 chars.
   */
  route(task: string, missionId = 'unknown'): RouteResult {
    const all = listManuals(this.knowledgeDir);
    const detected: { name: string; matches: string[]; manual: Manual; matchCount: number }[] = [];

    for (const { name, manual } of all) {
      const needles = makeNeedles(name, manual);
      const hits: string[] = [];
      let count = 0;
      for (const n of needles) {
        const c = countWordMatches(task, n);
        if (c > 0) { hits.push(n); count += c; }
      }
      if (count > 0) detected.push({ name, matches: hits, manual, matchCount: count });
    }

    detected.sort((a, b) => b.matchCount - a.matchCount);

    const totalCharBudget = this.maxTokens * ROUGH_CHARS_PER_TOKEN;
    const injected: RoutedManualSlice[] = [];
    const skipped: string[] = [];
    let used = 0;

    for (const d of detected) {
      const remaining = totalCharBudget - used;
      if (remaining <= 200) { skipped.push(d.name); continue; }
      const slice = buildSlice(d.name, d.manual, task, remaining);
      if (slice.chars === 0) { skipped.push(d.name); continue; }
      injected.push({
        program: d.name,
        source: d.manual.source.origin,
        injected_text: slice.text,
        injected_chars: slice.chars,
        matched_terms: d.matches,
      });
      used += slice.chars;
    }

    if (injected.length > 0) appendUsageLog(this.usageLogPath, missionId, injected);

    return { detected: detected.map((d) => d.name), injected, skipped };
  }

  /**
   * Returns a single string ready to splice into a sub-agent system prompt.
   * Empty string when no manuals matched.
   */
  buildPromptInjection(task: string, missionId = 'unknown'): { text: string; result: RouteResult } {
    const result = this.route(task, missionId);
    if (result.injected.length === 0) return { text: '', result };
    const blocks = result.injected.map((s) => s.injected_text);
    const text =
      `---- BEGIN INJECTED KNOWLEDGE (KnowledgeRouter) ----\n` +
      blocks.join('\n\n') +
      `\n---- END INJECTED KNOWLEDGE ----`;
    return { text, result };
  }
}
