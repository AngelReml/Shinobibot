// Habilidad C.1 — /learn <ruta_o_url>
// Acepta: repo local, repo de GitHub (clona shallow), o URL de docs (scraping).
// Produce knowledge/<programa>/manual.json con purpose / install / public_api /
// usage_patterns / gotchas / examples.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { spawnSync } from 'child_process';
import { tryParseJSON } from '../reader/schemas.js';
import { runRead } from '../reader/cli.js';
import { makeLLMClient } from '../reader/llm_adapter.js';
import type { LLMClient } from '../reader/SubAgent.js';

export interface Manual {
  purpose: string;
  install: string;
  public_api: { name: string; signature: string; summary: string }[];
  usage_patterns: { title: string; body: string }[];
  gotchas: string[];
  examples: { title: string; code: string }[];
  synonyms: string[];           // names this program also goes by (used by C.2 router)
  source: { kind: 'repo' | 'url'; origin: string; pages_or_files: number };
}

const MAX_PAGES = 20;

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

function isGithubRepoUrl(s: string): boolean {
  return /^https:\/\/github\.com\/[^/]+\/[^/?#]+\/?$/i.test(s);
}

function inferProgramName(input: string): string {
  if (isGithubRepoUrl(input)) {
    const m = input.match(/github\.com\/[^/]+\/([^/?#]+)/i);
    return (m?.[1] ?? 'unknown').replace(/\.git$/i, '').toLowerCase();
  }
  if (isUrl(input)) {
    const u = new URL(input);
    const host = u.hostname.replace(/^www\./, '');
    const parts = host.split('.');
    // For "docs.n8n.io" we want "n8n", for "fastapi.tiangolo.com" we want "fastapi".
    // Heuristic: if first label is a doc-ish prefix, use the second; else use first.
    const docPrefixes = new Set(['docs', 'doc', 'developer', 'developers', 'dev', 'api', 'reference', 'help', 'wiki']);
    if (parts.length >= 3 && docPrefixes.has(parts[0])) return parts[1].toLowerCase();
    return parts[0].toLowerCase();
  }
  return path.basename(path.resolve(input)).toLowerCase();
}

function fetch(url: string, timeoutMs = 15_000): Promise<{ status: number; body: string; finalUrl: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https://') ? https : http;
    // Some doc sites (Astro/Cloudflare) reject programmatic UAs. Use a real-browser UA.
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    };
    const req = lib.get(url, { headers }, (res) => {
      // Follow redirects (max 5)
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        fetch(next, timeoutMs).then(resolve, reject);
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8'), finalUrl: url }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`fetch timeout ${timeoutMs}ms`)));
  });
}

function htmlToText(html: string): string {
  // Strip script/style first, then tags, collapse whitespace.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractInternalLinks(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const links = new Set<string>();
  const re = /href\s*=\s*["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1];
    try {
      const abs = new URL(raw, base).toString();
      const u = new URL(abs);
      if (u.hostname === base.hostname && /^https?:/.test(u.protocol)) {
        // Drop fragments and query for dedup.
        u.hash = '';
        links.add(u.toString());
      }
    } catch { /* skip */ }
  }
  return [...links];
}

function metaRefreshTarget(html: string, baseUrl: string): string | undefined {
  const m = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["']\s*\d+\s*;\s*url=([^"'>\s]+)/i);
  if (!m) return undefined;
  try { return new URL(m[1], baseUrl).toString(); } catch { return undefined; }
}

async function scrapeDocs(rootUrl: string, max = MAX_PAGES): Promise<{ pages: { url: string; text: string }[] }> {
  const visited = new Set<string>();
  const queue: string[] = [rootUrl];
  const pages: { url: string; text: string }[] = [];

  while (queue.length > 0 && pages.length < max) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      const r = await fetch(url);
      if (r.status >= 400) continue;
      // Follow client-side meta-refresh redirects (Astro/Docusaurus default landing).
      const refresh = metaRefreshTarget(r.body, url);
      if (refresh && !visited.has(refresh)) {
        queue.unshift(refresh);
        continue;
      }
      const text = htmlToText(r.body);
      if (text.length < 50) continue;
      pages.push({ url, text: text.slice(0, 8_000) });
      const links = extractInternalLinks(r.body, url);
      links.sort((a, b) => scoreUrl(b) - scoreUrl(a));
      for (const l of links) {
        if (!visited.has(l) && pages.length + queue.length < max) queue.push(l);
      }
    } catch { /* skip */ }
  }
  return { pages };
}

function scoreUrl(u: string): number {
  let s = 0;
  if (/\/(docs|guide|api|reference)/i.test(u)) s += 5;
  if (/(installation|getting-started|quickstart|usage)/i.test(u)) s += 3;
  return s;
}

async function cloneShallow(repoUrl: string): Promise<string> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-learn-'));
  const dest = path.join(tmp, inferProgramName(repoUrl));
  const res = spawnSync('git', ['clone', '--depth', '1', repoUrl, dest], { encoding: 'utf-8' });
  if (res.status !== 0) {
    throw new Error(`git clone failed: ${(res.stderr || res.stdout).trim()}`);
  }
  return dest;
}

const SYNTH_SYSTEM = `You are a senior technical writer producing an internal manual for a software program/library that Shinobi will consult later when its sub-agents encounter the program in a task. Your reader is another LLM, not a human — favor density over fluency, but never invent.

Return ONE JSON object with this exact shape (no prose, no fence):
{
  "purpose": string (max 300),
  "install": string (max 300, exact install command(s) when known, else "unknown"),
  "public_api": [{"name": string, "signature": string (max 200), "summary": string (max 200)}],
  "usage_patterns": [{"title": string, "body": string (max 400)}],
  "gotchas": string[],
  "examples": [{"title": string, "code": string (max 800)}],
  "synonyms": string[],
  "source": {"kind": "repo" | "url", "origin": string, "pages_or_files": number}
}

Rules:
- Use ONLY information present in the provided pages or sub-reports. Do NOT invent function names, flags, install commands, or examples.
- If a field has no evidence, return [] (arrays) or "unknown" (strings) — do NOT guess.
- "synonyms" should include obvious aliases. Examples: "n8n" ↔ "n8n.io", "execa" ↔ "Execa", "p-event" ↔ "pEvent". Keep it short.
- "public_api" entries must have signatures with the exact parameter names from the source. If you only know the function name, set signature to "unknown" rather than fabricating one.
- Output JSON only.

Acceptable example entry: {"title":"Run a single command","code":"const {execa} = require('execa');\\nconst {stdout} = await execa('echo', ['hello']);\\nconsole.log(stdout);"}
Unacceptable example: code that uses APIs you only inferred ("execa.runWithRetry(...)" — when no doc you read mentions runWithRetry).

Self-check before emitting: for every public_api[].name, verify it appeared literally in at least one of the pages or sub-reports below. For every example, verify its function calls use only names from public_api or from the source. If a name doesn't trace back, drop it.`;

function validateManual(raw: unknown): { ok: true; value: Manual } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not object' };
  const r = raw as Record<string, unknown>;
  if (typeof r.purpose !== 'string') return { ok: false, error: 'purpose missing' };
  if (typeof r.install !== 'string') return { ok: false, error: 'install missing' };
  if (!Array.isArray(r.public_api)) return { ok: false, error: 'public_api not array' };
  if (!Array.isArray(r.usage_patterns)) return { ok: false, error: 'usage_patterns not array' };
  if (!Array.isArray(r.gotchas) || !r.gotchas.every((x) => typeof x === 'string')) return { ok: false, error: 'gotchas invalid' };
  if (!Array.isArray(r.examples)) return { ok: false, error: 'examples not array' };
  if (!Array.isArray(r.synonyms) || !r.synonyms.every((x) => typeof x === 'string')) return { ok: false, error: 'synonyms invalid' };
  const src = r.source as Record<string, unknown> | undefined;
  if (!src || (src.kind !== 'repo' && src.kind !== 'url')) return { ok: false, error: 'source.kind invalid' };
  if (typeof src.origin !== 'string') return { ok: false, error: 'source.origin invalid' };
  if (typeof src.pages_or_files !== 'number') return { ok: false, error: 'source.pages_or_files invalid' };
  return { ok: true, value: raw as Manual };
}

async function synthesizeManualFromPages(pages: { url: string; text: string }[], origin: string, llm: LLMClient): Promise<{ ok: true; value: Manual } | { ok: false; error: string }> {
  const userPrompt =
    `Source URL (root): ${origin}\nPages scraped: ${pages.length}\n\n` +
    pages.map((p, i) => `--- PAGE ${i + 1}: ${p.url} ---\n${p.text}`).join('\n\n');
  return synthesizeManual(userPrompt, llm);
}

async function synthesizeManualFromRepo(repoReportPath: string, repoOrigin: string, llm: LLMClient): Promise<{ ok: true; value: Manual } | { ok: false; error: string }> {
  const reportRaw = fs.readFileSync(repoReportPath, 'utf-8');
  const userPrompt =
    `Source repo: ${repoOrigin}\nRepo report (synth + sub-reports JSON):\n\n${reportRaw}`;
  return synthesizeManual(userPrompt, llm);
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

async function synthesizeManual(userPrompt: string, llm: LLMClient): Promise<{ ok: true; value: Manual } | { ok: false; error: string }> {
  const callOnce = async (extra = '', model = 'claude-sonnet-4-6'): Promise<unknown> => {
    const raw = await llm.chat(
      [
        { role: 'system', content: SYNTH_SYSTEM + (extra ? '\n\n' + extra : '') },
        { role: 'user', content: userPrompt },
      ],
      { model },
    );
    return tryParseJSON(raw);
  };

  // First attempt: opus.
  let parsed: unknown;
  try { parsed = await callOnce(); }
  catch (e: any) {
    const msg = String(e?.message ?? e);
    // 429 from upstream → backoff and downgrade to haiku for the retry.
    if (msg.includes('429')) {
      console.log('[learn] rate-limited on opus; backing off 8s and retrying with haiku');
      await sleep(8_000);
      try { parsed = await callOnce('', 'z-ai/glm-4.7-flash'); }
      catch (e2: any) { return { ok: false, error: `LLM call failed (after 429 backoff): ${e2?.message ?? e2}` }; }
    } else {
      return { ok: false, error: `LLM call failed: ${msg}` };
    }
  }
  let v = validateManual(parsed);
  if (v.ok) return v;
  try {
    parsed = await callOnce(`Your previous response failed validation: ${v.error}. Return strictly valid JSON now.`);
  } catch (e: any) {
    return { ok: false, error: `LLM retry failed: ${e?.message ?? e}` };
  }
  v = validateManual(parsed);
  if (v.ok) return v;
  return { ok: false, error: `validation failed twice: ${v.error}` };
}

export interface RunLearnResult {
  ok: boolean;
  manualPath: string;
  programName: string;
}

export async function runLearn(input: string, opts: { knowledgeDir?: string } = {}): Promise<RunLearnResult> {
  const knowledgeDir = opts.knowledgeDir ?? path.join(process.cwd(), 'knowledge');
  const programName = inferProgramName(input);
  const programDir = path.join(knowledgeDir, programName);
  fs.mkdirSync(programDir, { recursive: true });

  console.log(`[learn] target: ${input}`);
  console.log(`[learn] program name: ${programName}`);
  console.log(`[learn] output: ${programDir}/manual.json`);

  const llm = makeLLMClient();
  let result: { ok: true; value: Manual } | { ok: false; error: string };

  if (isUrl(input) && !isGithubRepoUrl(input)) {
    console.log(`[learn] mode: docs scrape (max ${MAX_PAGES} pages)`);
    const { pages } = await scrapeDocs(input);
    console.log(`[learn] scraped ${pages.length} page(s)`);
    if (pages.length === 0) {
      console.log('[learn] no pages reachable — abort');
      return { ok: false, manualPath: '', programName };
    }
    result = await synthesizeManualFromPages(pages, input, llm);
    if (result.ok) result.value.source = { kind: 'url', origin: input, pages_or_files: pages.length };
  } else {
    let repoPath = input;
    let cleanup = false;
    if (isGithubRepoUrl(input)) {
      console.log('[learn] mode: github clone (shallow) + repo read');
      try { repoPath = await cloneShallow(input); cleanup = true; }
      catch (e: any) {
        console.log(`[learn] clone failed: ${e?.message ?? e}`);
        return { ok: false, manualPath: '', programName };
      }
    } else {
      console.log('[learn] mode: local repo read');
    }
    const r = await runRead(repoPath, { label: `learn_${programName}` });
    if (!r.ok) {
      console.log('[learn] read failed — manual cannot be synthesized');
      if (cleanup) fs.rmSync(repoPath, { recursive: true, force: true });
      return { ok: false, manualPath: '', programName };
    }
    const reportPath = path.join(r.missionDir, 'report.json');
    result = await synthesizeManualFromRepo(reportPath, input, llm);
    if (result.ok) result.value.source = { kind: 'repo', origin: input, pages_or_files: result.value.public_api.length };
    if (cleanup) fs.rmSync(repoPath, { recursive: true, force: true });
  }

  if (!result.ok) {
    console.log(`[learn] manual synthesis failed: ${result.error}`);
    return { ok: false, manualPath: '', programName };
  }

  const manualPath = path.join(programDir, 'manual.json');
  fs.writeFileSync(manualPath, JSON.stringify(result.value, null, 2));
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`MANUAL — ${programName}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`purpose: ${result.value.purpose}`);
  console.log(`install: ${result.value.install}`);
  console.log(`public_api: ${result.value.public_api.length} entries`);
  console.log(`usage_patterns: ${result.value.usage_patterns.length}`);
  console.log(`gotchas: ${result.value.gotchas.length}`);
  console.log(`examples: ${result.value.examples.length}`);
  console.log(`synonyms: ${result.value.synonyms.join(', ') || '(none)'}`);
  console.log('');
  console.log(`[learn] manual: ${manualPath}`);
  return { ok: true, manualPath, programName };
}

export function parseLearnArgs(argv: string): { input?: string; error?: string } {
  const trimmed = argv.trim();
  if (!trimmed) return { error: 'Usage: /learn <ruta_local | https://github.com/u/repo | https://docs.example.com>' };
  return { input: trimmed.split(/\s+/)[0] };
}
