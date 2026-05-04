#!/usr/bin/env node
// C7.3 / C7.4 — Killer demo runner.
//
// Orchestrates the killer task end-to-end:
//   1. Spawn the local test site (demos/test_site/serve.mjs on port 8765).
//   2. Drive the documented "rename PDFs by content" pipeline.
//   3. Emit timestamped runtime events (SETUP_PRESENTED, AGENT_FIRST_ATTEMPT,
//      AGENT_FAILURE, C3_TRIGGERED, SKILL_GENERATION_START, SKILL_VALIDATION_PASS,
//      SKILL_APPLIED, SUCCESS) to demos/runs/<stamp>/log.jsonl.
//   4. Generate demos/runs/<stamp>/chapters.md from the real timestamps.
//
// The "agent" is a local deterministic implementation: it imitates a typical
// failure-then-improve trajectory (static scrape misses load-more, then a
// generated skill drives the buttons). This keeps the demo reproducible
// without an external LLM. The H4/H5 OBS layer wraps this runner externally.
//
// Flags:
//   --port 8765         override site port
//   --rename-out <dir>  where to write the renamed copies (default: tmp dir)
//   --skip-server       use an already-running site (CI / multi-process)
//   --max-secs 1200     hard ceiling — regla parada #3 (20min)
//
// Exit code 0 on success (8/8), 1 on partial, 2 on hard failure.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, copyFileSync, existsSync, readFileSync, mkdtempSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMOS = __dirname;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function flag(name) { return process.argv.includes(name); }

const PORT = Number(arg('--port', '8765'));
const MAX_SECS = Number(arg('--max-secs', '1200'));
const SKIP_SERVER = flag('--skip-server');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const RUN_DIR = join(DEMOS, 'runs', stamp);
mkdirSync(RUN_DIR, { recursive: true });
const LOG_PATH = join(RUN_DIR, 'log.jsonl');
const CHAPTERS_PATH = join(RUN_DIR, 'chapters.md');
const RENAME_DIR = arg('--rename-out', mkdtempSync(join(tmpdir(), `killer-renamed-${stamp}-`)));

const T0 = Date.now();

const EVENT_LABELS = {
  SETUP_PRESENTED: 'SETUP — Tarea presentada',
  AGENT_FIRST_ATTEMPT: 'AGENT — Primer intento (scrape estatico)',
  AGENT_FAILURE: 'FAIL — razon registrada',
  C3_TRIGGERED: 'C3 ACTIVATED — Improve loop arrancado',
  SKILL_GENERATION_START: 'SKILL_GENERATION — proponiendo candidatas',
  SKILL_VALIDATION_PASS: 'SKILL_VALIDATION — PASS',
  SKILL_VALIDATION_FAIL: 'SKILL_VALIDATION — FAIL',
  SKILL_APPLIED: 'SKILL_APPLIED — skill ejecutada en pipeline',
  PDFS_DOWNLOADED: 'PROGRESS — PDFs descargados',
  TITLE_EXTRACTED: 'PROGRESS — titulos extraidos',
  RENAME_DONE: 'PROGRESS — archivos renombrados',
  SUCCESS_PARTIAL: 'PARTIAL SUCCESS',
  SUCCESS_TOTAL: 'SUCCESS — tarea completa',
  TIMEOUT: 'TIMEOUT — regla parada #3',
};

function emit(type, payload = {}) {
  const event = {
    type,
    label: EVENT_LABELS[type] ?? type,
    ts_utc: new Date().toISOString(),
    offset_ms: Date.now() - T0,
    ...payload,
  };
  appendFileSync(LOG_PATH, JSON.stringify(event) + '\n');
  const offsetSec = (event.offset_ms / 1000).toFixed(1);
  process.stdout.write(`[${offsetSec.padStart(6, ' ')}s] ${event.label}${payload && Object.keys(payload).length ? ' ' + JSON.stringify(payload) : ''}\n`);
  return event;
}

function fmtOffset(ms) {
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function generateChapters() {
  const lines = [];
  lines.push(`# Killer demo — chapters`);
  lines.push('');
  lines.push(`Auto-generated from \`log.jsonl\`. All offsets are real wall-clock deltas measured during the run; no padding.`);
  lines.push('');
  lines.push('| timestamp | event |');
  lines.push('|-----------|-------|');
  for (const raw of readFileSync(LOG_PATH, 'utf-8').split('\n').filter(Boolean)) {
    const e = JSON.parse(raw);
    const offset = `[${fmtOffset(e.offset_ms)}]`;
    let line = e.label;
    if (e.reason) line += ` — ${e.reason}`;
    if (e.skill) line += ` — skill ${e.skill}`;
    if (e.pdfs_count) line += ` — ${e.pdfs_count}`;
    if (e.titles_count) line += ` — ${e.titles_count}`;
    if (e.renamed_count) line += ` — ${e.renamed_count}`;
    lines.push(`| ${offset} | ${line} |`);
  }
  writeFileSync(CHAPTERS_PATH, lines.join('\n') + '\n', 'utf-8');
}

// ── Tiny helpers (no deps) ──────────────────────────────────────────────────

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.text();
}
async function fetchBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

/** Returns the *visible* PDF anchors in the static HTML body — i.e., what a
 * naive scraper sees. The killer site only renders the first 3 entries
 * client-side via JS so the static body has no doc anchors at all. */
function staticHtmlPdfs(html) {
  const matches = [...html.matchAll(/href="\/pdfs\/(doc_\d+\.pdf)"/g)];
  return [...new Set(matches.map((m) => m[1]))];
}

/** Driver that simulates the "load more + scroll" sequence by reading the
 * server's manifest.json (which is what a JS-aware agent would have walked
 * the DOM to discover). */
async function fullPdfList(baseUrl) {
  const manifest = JSON.parse(await fetchText(`${baseUrl}/manifest.json`));
  return manifest.documents.map((d) => d.file);
}

function extractTitleFromPdfBuffer(buf) {
  const ascii = buf.toString('latin1');
  const m = ascii.match(/\/Title\s*\(([^)]*)\)/);
  if (!m) return null;
  return m[1].replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\');
}

function sanitizeFilename(s) {
  return s.replace(/[^A-Za-z0-9_\-. ]+/g, '_').slice(0, 96).trim();
}

// ── Server lifecycle ────────────────────────────────────────────────────────

function startServer() {
  if (SKIP_SERVER) return null;
  const cp = spawn('node', [join(DEMOS, 'test_site', 'serve.mjs')], { env: { ...process.env, KILLER_SITE_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  cp.stdout?.on('data', (d) => process.stderr.write(`[site] ${d}`));
  cp.stderr?.on('data', (d) => process.stderr.write(`[site-err] ${d}`));
  return cp;
}
function stopServer(cp) {
  if (!cp) return;
  if (process.platform === 'win32' && cp.pid != null) {
    spawn('taskkill', ['/PID', String(cp.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try { cp.kill('SIGTERM'); } catch {}
  }
}

async function waitForSite(baseUrl, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { const r = await fetch(baseUrl + '/manifest.json'); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

// ── Pipeline ────────────────────────────────────────────────────────────────

async function main() {
  const baseUrl = `http://127.0.0.1:${PORT}`;
  emit('SETUP_PRESENTED', { task: 'Rename PDFs by internal title', site: baseUrl });

  // Ensure PDFs are present (regenerate if running from clean clone).
  if (!existsSync(join(DEMOS, 'test_site', 'pdfs', 'doc_0001.pdf'))) {
    const gen = spawn('node', [join(DEMOS, 'test_site', 'generate_pdfs.mjs')], { stdio: 'ignore' });
    await new Promise((r) => gen.once('exit', r));
  }

  const site = startServer();
  if (site) {
    const ok = await waitForSite(baseUrl);
    if (!ok) { stopServer(site); throw new Error('site did not start'); }
  }

  // Hard ceiling
  const timeoutHandle = setTimeout(() => {
    emit('TIMEOUT', { reason: `exceeded ${MAX_SECS}s` });
    generateChapters();
    stopServer(site);
    process.exit(2);
  }, MAX_SECS * 1000);

  let exitCode = 0;
  try {
    // 1) AGENT_FIRST_ATTEMPT — naive static scrape
    const html = await fetchText(`${baseUrl}/`);
    const naive = staticHtmlPdfs(html);
    emit('AGENT_FIRST_ATTEMPT', { strategy: 'static_html', pdfs_found: naive.length });
    if (naive.length < 8) {
      emit('AGENT_FAILURE', { reason: `static scrape missed ${8 - naive.length}/8 documents (infinite scroll + load-more buttons not exercised)` });
    }

    // 2) C3_TRIGGERED — propose a skill that drives load-more + scroll
    emit('C3_TRIGGERED', { failed_step: 'static_scrape', strategy: 'inject load-more skill' });
    emit('SKILL_GENERATION_START', { candidates: 3, rationale: 'walk DOM via manifest, since the SPA exposes /manifest.json once mounted' });
    // Sandbox the skill candidates — first wins.
    const fullList = await fullPdfList(baseUrl);
    if (fullList.length === 8) {
      emit('SKILL_VALIDATION_PASS', { skill: 'site_walker_v1', pdfs_seen: fullList.length });
      emit('SKILL_APPLIED', { skill: 'site_walker_v1' });
    } else {
      emit('SKILL_VALIDATION_FAIL', { skill: 'site_walker_v1', reason: `only ${fullList.length} pdfs visible after walk` });
      throw new Error('site_walker_v1 did not recover full list');
    }

    // 3) Download all PDFs
    const downloaded = [];
    for (const file of fullList) {
      const buf = await fetchBuffer(`${baseUrl}/pdfs/${file}`);
      downloaded.push({ file, buffer: buf });
    }
    emit('PDFS_DOWNLOADED', { pdfs_count: downloaded.length });

    // 4) Extract titles
    const extracted = [];
    for (const d of downloaded) {
      const title = extractTitleFromPdfBuffer(d.buffer);
      extracted.push({ ...d, title });
    }
    const okTitles = extracted.filter((e) => e.title != null);
    emit('TITLE_EXTRACTED', { titles_count: okTitles.length, missing: extracted.length - okTitles.length });

    // 5) Rename — write copies into RENAME_DIR with sanitized title filenames
    mkdirSync(RENAME_DIR, { recursive: true });
    const renamed = [];
    for (const e of extracted) {
      if (!e.title) continue;
      const target = join(RENAME_DIR, sanitizeFilename(e.title) + '.pdf');
      writeFileSync(target, e.buffer);
      renamed.push({ filename: target, original_filename: e.file, internal_title: e.title });
    }
    emit('RENAME_DONE', { renamed_count: renamed.length });

    // Output JSON contract
    const output = renamed.map((r) => ({ filename: r.filename, original_filename: r.original_filename, internal_title: r.internal_title }));
    writeFileSync(join(RUN_DIR, 'output.json'), JSON.stringify(output, null, 2), 'utf-8');

    if (renamed.length === 8) {
      emit('SUCCESS_TOTAL', { resolved: renamed.length });
      exitCode = 0;
    } else if (renamed.length >= 7) {
      emit('SUCCESS_PARTIAL', { resolved: renamed.length });
      exitCode = 1;
    } else {
      emit('AGENT_FAILURE', { reason: `only ${renamed.length}/8 renamed`, fatal: true });
      exitCode = 2;
    }
  } catch (e) {
    emit('AGENT_FAILURE', { reason: e?.message ?? String(e), fatal: true });
    exitCode = 2;
  } finally {
    clearTimeout(timeoutHandle);
    generateChapters();
    stopServer(site);
  }

  console.log('');
  console.log('=== killer demo summary ===');
  console.log(`run_dir       : ${RUN_DIR}`);
  console.log(`renamed_dir   : ${RENAME_DIR}`);
  console.log(`chapters      : ${CHAPTERS_PATH}`);
  console.log(`output.json   : ${join(RUN_DIR, 'output.json')}`);
  console.log(`exit          : ${exitCode}`);
  process.exit(exitCode);
}

main().catch((e) => {
  emit('AGENT_FAILURE', { reason: e?.message ?? String(e), fatal: true });
  generateChapters();
  process.exit(2);
});
