// S1.4 baseline/after runner.
// Ejecuta las 5 tareas × 3 runs y vuelca outputs en docs/s1_4/<phase>/.
// Phase: 'baseline' (CHECKPOINT 4) o 'after' (CHECKPOINT 6).
//
// Uso:
//   npx tsx scripts/s1_4_runner.ts baseline
//   npx tsx scripts/s1_4_runner.ts after

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { runRead } from '../src/reader/cli.js';
import { runSelf } from '../src/reader/self.js';
import { runCommittee, findLatestSelfReport } from '../src/committee/cli.js';
import { runImprovements } from '../src/committee/improvements.js';
import { runLearn } from '../src/knowledge/learn.js';
import { runAudit } from '../src/audit/runAudit.js';

const phase = (process.argv[2] || '').toLowerCase();
if (phase !== 'baseline' && phase !== 'after') {
  console.error(`Usage: npx tsx scripts/s1_4_runner.ts <baseline|after>`);
  process.exit(2);
}
const OUT_DIR = path.join(process.cwd(), 'docs', 's1_4', phase);
fs.mkdirSync(OUT_DIR, { recursive: true });

// A/B sobre el sistema REAL: cada tarea usa los logical names que Shinobi
// emplea en producción (Haiku para sub-agents, Opus para synth/committee,
// Opus para improvements/learn/regenerate), enrutados vía OpenRouter.
if (!process.env.OPENROUTER_API_KEY) {
  console.error('OPENROUTER_API_KEY no está en .env. La evaluación A/B usa OpenRouter.');
  console.error('Aborta: configura la key en .env y vuelve a ejecutar.');
  process.exit(2);
}
console.log(`[s1_4_runner] phase=${phase}, provider=OpenRouter (logical models por tarea)`);

interface RunRecord { task: string; run: number; durationMs: number; ok: boolean; outFile: string; notes?: string }
const records: RunRecord[] = [];

function copyFile(src: string, dst: string): boolean {
  if (!fs.existsSync(src)) return false;
  fs.copyFileSync(src, dst);
  return true;
}

function isTransient(e: unknown): boolean {
  const msg = String((e as any)?.message ?? e ?? '').toLowerCase();
  // Network/timeouts/5xx/429 are transient. Validation errors and missing
  // files are NOT transient — those mean the task is genuinely broken.
  if (/timeout|econnreset|enotfound|ehostunreach|epipe|socket hang up|network/.test(msg)) return true;
  if (/status code 5\d\d/.test(msg)) return true;
  if (/status code 429|rate.?limit/.test(msg)) return true;
  return false;
}

async function withRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = 3, backoffMs = 8_000): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt === maxAttempts) break;
      if (!isTransient(e)) {
        // Non-transient (validation, missing input) — don't retry.
        throw e;
      }
      const wait = backoffMs * attempt;
      console.log(`[retry] ${label} attempt ${attempt} failed (${(e as Error).message}). backing off ${wait/1000}s…`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

function newest(dir: string, ext: string): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(ext)).sort();
  if (files.length === 0) return undefined;
  return path.join(dir, files[files.length - 1]);
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; durationMs: number }> {
  const t0 = Date.now();
  const value = await fn();
  return { value, durationMs: Date.now() - t0 };
}

// ── T1: audit DVWA ──────────────────────────────────────────────────────────
const DVWA_SHA = '33e364c556e91473a5e979a4db16ee3b393d05ba';
async function t1(run: number) {
  const machineDir = path.join(process.cwd(), 'audits', '.machine');
  // Limpiar cache F1 (archivos por SHA-only) antes de cada run.
  if (fs.existsSync(machineDir)) {
    for (const f of fs.readdirSync(machineDir)) {
      if (f.startsWith(DVWA_SHA)) fs.unlinkSync(path.join(machineDir, f));
    }
  }
  const auditsDir = path.join(process.cwd(), 'audits');
  if (fs.existsSync(auditsDir)) {
    for (const f of fs.readdirSync(auditsDir)) {
      if (/digininja__DVWA/i.test(f)) fs.unlinkSync(path.join(auditsDir, f));
    }
  }
  const t = await timed(() => withRetry(`T1.run${run}`, () => runAudit({ url: 'https://github.com/digininja/DVWA' })));
  const r = t.value;
  const out = path.join(OUT_DIR, `T1_run${run}_audit.md`);
  const ok = r.ok && copyFile(r.mdPath, out);
  records.push({ task: 'T1', run, durationMs: t.durationMs, ok, outFile: out, notes: ok ? `verdict=${r.verdict}/${r.overallRisk} sha=${r.sha.slice(0,8)}` : 'audit failed' });
  console.log(`[T1.run${run}] ok=${ok} dur=${(t.durationMs/1000).toFixed(1)}s`);
}

// ── T2: self read ───────────────────────────────────────────────────────────
async function t2(run: number) {
  const t = await timed(() => withRetry(`T2.run${run}`, () => runSelf({})));
  const r = t.value;
  const out = path.join(OUT_DIR, `T2_run${run}_self.json`);
  const ok = r.ok && copyFile(r.selfReportPath, out);
  records.push({ task: 'T2', run, durationMs: t.durationMs, ok, outFile: out });
  console.log(`[T2.run${run}] ok=${ok} dur=${(t.durationMs/1000).toFixed(1)}s`);
}

// ── T3: committee standalone (sobre último self_report) ─────────────────────
async function t3(run: number) {
  const target = findLatestSelfReport();
  if (!target) {
    records.push({ task: 'T3', run, durationMs: 0, ok: false, outFile: '', notes: 'no self_report — run T2 first' });
    return;
  }
  const t = await timed(() => withRetry(`T3.run${run}`, () => runCommittee(target)));
  const r = t.value;
  const out = path.join(OUT_DIR, `T3_run${run}_committee.json`);
  const ok = r.ok && copyFile(r.outputPath, out);
  records.push({ task: 'T3', run, durationMs: t.durationMs, ok, outFile: out });
  console.log(`[T3.run${run}] ok=${ok} dur=${(t.durationMs/1000).toFixed(1)}s`);
}

// ── T4: learn valibot ───────────────────────────────────────────────────────
async function t4(run: number) {
  const dir = path.join(process.cwd(), 'knowledge', 'valibot');
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  const t = await timed(() => withRetry(`T4.run${run}`, () => runLearn('https://valibot.dev')));
  const r = t.value;
  const out = path.join(OUT_DIR, `T4_run${run}_manual.json`);
  const ok = r.ok && copyFile(r.manualPath, out);
  records.push({ task: 'T4', run, durationMs: t.durationMs, ok, outFile: out, notes: ok ? `program=${r.programName}` : 'learn failed' });
  console.log(`[T4.run${run}] ok=${ok} dur=${(t.durationMs/1000).toFixed(1)}s`);
}

// ── T5: improvements (sobre último committee_report) ────────────────────────
async function t5(run: number) {
  const t = await timed(() => withRetry(`T5.run${run}`, () => runImprovements()));
  const r = t.value;
  const out = path.join(OUT_DIR, `T5_run${run}_proposals.json`);
  // proposals/<ts>.json — copiar el más reciente
  const proposalsDir = path.join(process.cwd(), 'proposals');
  const latestJson = newest(proposalsDir, '.json');
  const ok = r.ok && latestJson !== undefined && copyFile(latestJson, out);
  records.push({ task: 'T5', run, durationMs: t.durationMs, ok, outFile: out, notes: ok ? `proposals=${r.proposals.length}` : 'improvements failed' });
  console.log(`[T5.run${run}] ok=${ok} dur=${(t.durationMs/1000).toFixed(1)}s`);
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  console.log(`═══ S1.4 ${phase.toUpperCase()} runner ═══`);
  console.log(`output dir: ${OUT_DIR}`);
  console.log('');

  // Cadena T2→T3→T5 por run, T1 y T4 independientes.
  // Sleep entre tareas para evitar rate limiting (429) — ver fallo en baseline run 3.
  const SLEEP_MS = 25_000;
  for (let i = 1; i <= 3; i++) {
    console.log(`\n── run ${i}/3 ──`);
    await t2(i);  await sleep(SLEEP_MS);
    await t3(i);  await sleep(SLEEP_MS);
    await t5(i);  await sleep(SLEEP_MS);
    await t4(i);  await sleep(SLEEP_MS);
    await t1(i);
    if (i < 3) await sleep(SLEEP_MS);
  }

  // SUMMARY.md
  const summaryPath = path.join(OUT_DIR, 'SUMMARY.md');
  const okCount = records.filter((r) => r.ok).length;
  const failCount = records.filter((r) => !r.ok).length;
  const lines: string[] = [];
  lines.push(`# S1.4 — ${phase} SUMMARY`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Phase: \`${phase}\``);
  lines.push(`Modelo: Ruta A — gpt-4o-mini (sub-agents) + gpt-4o (synth/committee). temperature=0 (F1).`);
  lines.push('');
  lines.push(`Resultado: **${okCount}/${records.length} runs OK**, ${failCount} fallos.`);
  lines.push('');
  lines.push('| Task | Run | Duración (s) | OK | Output | Notas |');
  lines.push('|------|-----|--------------|----|--------|-------|');
  for (const r of records) {
    const dur = (r.durationMs / 1000).toFixed(1);
    const fname = r.outFile ? path.basename(r.outFile) : '—';
    const okMark = r.ok ? '✅' : '❌';
    lines.push(`| ${r.task} | ${r.run} | ${dur} | ${okMark} | \`${fname}\` | ${r.notes ?? ''} |`);
  }
  lines.push('');
  lines.push('## Observaciones cualitativas (rellenar manualmente tras revisar outputs)');
  lines.push('');
  lines.push('### T1 — Audit DVWA');
  lines.push('- Varianza entre runs: ');
  lines.push('- Hallucinations detectadas: ');
  lines.push('- Verdict consistente: ');
  lines.push('');
  lines.push('### T2 — Self read');
  lines.push('- Cobertura módulos plan v1.0: ');
  lines.push('- Hallucinations detectadas: ');
  lines.push('');
  lines.push('### T3 — Committee standalone');
  lines.push('- Diferenciación de roles: ');
  lines.push('- Disensos reales: ');
  lines.push('');
  lines.push('### T4 — Learn valibot');
  lines.push('- Conceptos clave capturados: ');
  lines.push('- API hallucination: ');
  lines.push('');
  lines.push('### T5 — Improvements');
  lines.push('- Aplicabilidad: ');
  lines.push('- Hallucinations de paths: ');
  fs.writeFileSync(summaryPath, lines.join('\n') + '\n');
  console.log('');
  console.log(`SUMMARY: ${summaryPath}`);

  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2); });
