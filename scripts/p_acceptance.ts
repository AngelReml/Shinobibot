// Acceptance suite P2-P11 from prompt.txt.
// Reports each test with PASS/FAIL + 1-2 lines.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { runRead } from '../src/reader/cli.js';
import { runSelf, runSelfDiff } from '../src/reader/self.js';
import { runCommittee, findLatestSelfReport } from '../src/committee/cli.js';
import { runImprovements } from '../src/committee/improvements.js';
import { runLearn } from '../src/knowledge/learn.js';
import { runAudit } from '../src/audit/runAudit.js';
import { MissionLedger } from '../src/ledger/MissionLedger.js';

interface PResult { id: string; status: 'PASS' | 'FAIL' | 'SKIP'; note: string }
const results: PResult[] = [];
function log(p: PResult) { results.push(p); console.log(`\n[${p.id}] ${p.status} — ${p.note}\n`); }

function fileText(p: string): string { try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; } }

async function p2() {
  console.log('═══ P2 — /read OpenGravity ═══');
  const r = await runRead('C:\\Users\\angel\\Desktop\\OpenGravity', { label: 'p2_opengravity' });
  if (!r.ok) return log({ id: 'P2', status: 'FAIL', note: 'runRead failed' });
  const report = JSON.parse(fileText(path.join(r.missionDir, 'report.json')));
  const summary = JSON.stringify(report).toLowerCase();
  const knownConcepts = ['kernel', 'agent', 'mission', 'opengravity'];
  const found = knownConcepts.filter((c) => summary.includes(c));
  log({ id: 'P2', status: found.length >= 2 ? 'PASS' : 'FAIL', note: `mentions [${found.join(',')}], dur=${(r.durationMs / 1000).toFixed(1)}s, mission=${path.basename(r.missionDir)}` });
}

async function p3() {
  console.log('═══ P3 — /read zod ═══');
  const dest = 'C:\\Users\\angel\\Desktop\\test_repos\\zod';
  if (!fs.existsSync(dest)) {
    const cl = spawnSync('git', ['clone', '--depth', '1', 'https://github.com/colinhacks/zod', dest], { encoding: 'utf-8' });
    if (cl.status !== 0) return log({ id: 'P3', status: 'FAIL', note: 'clone failed' });
  }
  const t0 = Date.now();
  const r = await runRead(dest, { label: 'p3_zod' });
  const dur = (Date.now() - t0) / 1000;
  if (!r.ok) return log({ id: 'P3', status: 'FAIL', note: `runRead failed after ${dur.toFixed(1)}s` });
  const report = JSON.parse(fileText(path.join(r.missionDir, 'report.json')));
  const text = JSON.stringify(report).toLowerCase();
  const concepts = ['parse', 'schema', 'refinement', 'transform', 'validation', 'type'];
  const found = concepts.filter((c) => text.includes(c));
  const within3min = dur < 180;
  const pass = within3min && found.length >= 3;
  log({ id: 'P3', status: pass ? 'PASS' : 'FAIL', note: `dur=${dur.toFixed(1)}s, concepts=[${found.join(',')}], within_3min=${within3min}` });
}

async function p4() {
  console.log('═══ P4 — /self + edit + /self --diff ═══');
  const r1 = await runSelf({});
  if (!r1.ok) return log({ id: 'P4', status: 'FAIL', note: 'first /self failed' });
  // Edit a file
  const target = 'src/reader/SubAgent.ts';
  const txt = fs.readFileSync(target, 'utf-8');
  const marker = `\n// p4-marker-${Date.now()}\n`;
  fs.writeFileSync(target, txt + marker);
  try {
    const r2 = await runSelf({});
    if (!r2.ok) return log({ id: 'P4', status: 'FAIL', note: 'second /self failed' });
    const diff = await runSelfDiff();
    const detected = diff.diffs.length > 0;
    log({ id: 'P4', status: detected ? 'PASS' : 'FAIL', note: `${diff.diffs.length} structural diffs detected after edit` });
  } finally {
    fs.writeFileSync(target, txt);  // restore
  }
}

async function p5() {
  console.log('═══ P5 — /committee disenso ═══');
  const target = findLatestSelfReport();
  if (!target) return log({ id: 'P5', status: 'FAIL', note: 'no self_report' });
  const r = await runCommittee(target);
  if (!r.ok) return log({ id: 'P5', status: 'FAIL', note: 'committee failed' });
  const data = JSON.parse(fileText(r.outputPath));
  const dissents = data?.synthesis?.dissents ?? [];
  log({ id: 'P5', status: dissents.length >= 1 ? 'PASS' : 'FAIL', note: `${dissents.length} dissents detected` });
}

async function p6() {
  console.log('═══ P6 — /improvements ═══');
  const r = await runImprovements();
  if (!r.ok) return log({ id: 'P6', status: 'FAIL', note: 'no proposals' });
  const proposals = r.proposals;
  // diff syntax check: contains @@ hunk
  const allSyntaxOk = proposals.every((p) => p.diff.includes('@@'));
  log({ id: 'P6', status: proposals.length >= 3 && allSyntaxOk ? 'PASS' : 'FAIL', note: `${proposals.length} proposals, all_have_hunk=${allSyntaxOk}, files=[${proposals.map((p) => p.file).join(' | ')}]` });
}

async function p7() {
  console.log('═══ P7 — /learn astro ═══');
  const r = await runLearn('https://docs.astro.build');
  if (!r.ok) return log({ id: 'P7', status: 'FAIL', note: 'learn failed' });
  const manualPath = path.join(process.cwd(), 'knowledge', r.programName, 'manual.json');
  const manual = JSON.parse(fileText(manualPath));
  const txt = JSON.stringify(manual).toLowerCase();
  const concepts = ['component', 'island', 'route', 'static', 'page', 'layout'];
  const found = concepts.filter((c) => txt.includes(c));
  const purposeNonGeneric = (manual.purpose ?? '').length > 50 && !/^astro is a framework\.?$/i.test((manual.purpose ?? '').trim());
  log({ id: 'P7', status: found.length >= 2 && purposeNonGeneric ? 'PASS' : 'FAIL', note: `program=${r.programName}, concepts=[${found.join(',')}], purpose_specific=${purposeNonGeneric}` });
}

async function p8() {
  console.log('═══ P8 — KnowledgeRouter usage.log inyecta astro ═══');
  // Need a small repo that mentions astro. Use the local Shinobi repo with a temp
  // task referencing astro so the KnowledgeRouter triggers. Simulate via a local
  // synthetic repo containing "astro" in README to ensure leafs pick it up.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p8-'));
  fs.writeFileSync(path.join(tmp, 'README.md'), '# test\nThis project integrates with astro for SSR.\n');
  fs.mkdirSync(path.join(tmp, 'src'));
  fs.writeFileSync(path.join(tmp, 'src', 'index.ts'), 'export const x = 1;\n');
  // Use runRead which goes through HierarchicalReader is for /read; runAudit uses
  // KnowledgeRouter. We invoke runAudit on a fake github URL? No — runAudit needs
  // git. Instead we simulate the router directly: invoke router.buildPromptInjection
  // with a string mentioning astro and ensure usage.log records it.
  const { KnowledgeRouter } = await import('../src/knowledge/KnowledgeRouter.js');
  const router = new KnowledgeRouter();
  const logPath = path.join(process.cwd(), 'knowledge', 'usage.log');
  const before = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '';
  const inj = router.buildPromptInjection('Audit task that mentions astro framework integration.', 'P8-mission');
  const after = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '';
  const newLines = after.slice(before.length);
  const ok = inj.text.length > 0 && /"program":\s*"astro"/.test(newLines) && /P8-mission/.test(newLines);
  fs.rmSync(tmp, { recursive: true, force: true });
  log({ id: 'P8', status: ok ? 'PASS' : 'FAIL', note: `astro inj ${inj.text.length>0?'YES':'NO'}, log entry recorded=${/P8-mission/.test(newLines)}` });
}

async function p9() {
  console.log('═══ P9 — shinobi audit p-queue ═══');
  const t0 = Date.now();
  const r = await runAudit({ url: 'https://github.com/sindresorhus/p-queue' });
  const dur = (Date.now() - t0) / 1000;
  const within5min = dur < 300;
  const md = fs.existsSync(r.mdPath) ? fs.readFileSync(r.mdPath, 'utf-8') : '';
  const sectionsOk = ['## Purpose', '## Architecture', '## Risks', '## Recommendations', 'Verdict:'].every((s) => md.includes(s));
  log({ id: 'P9', status: within5min && sectionsOk && r.contractPass ? 'PASS' : 'FAIL', note: `dur=${dur.toFixed(1)}s, sections=${sectionsOk}, contract=${r.contractPass}, verdict=${r.verdict}` });
}

async function p10() {
  console.log('═══ P10 — /ledger verify (intacto) + tampering ═══');
  const ledger = new MissionLedger();
  const v1 = ledger.verify();
  if (!v1.ok) return log({ id: 'P10', status: 'FAIL', note: `chain already broken before tamper test (${v1.entries} entries)` });
  // Tamper entry 5 (0-indexed: index 4)
  const file = 'ledger/chain.jsonl';
  const original = fs.readFileSync(file, 'utf-8');
  const lines = original.split(/\n/).filter(Boolean);
  if (lines.length < 5) return log({ id: 'P10', status: 'FAIL', note: `chain has only ${lines.length} entries (<5)` });
  const e = JSON.parse(lines[4]);
  e.output_hash = e.output_hash.slice(0, -1) + (e.output_hash.endsWith('a') ? 'b' : 'a');  // change one char
  lines[4] = JSON.stringify(e);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  try {
    const ledger2 = new MissionLedger();
    const v2 = ledger2.verify();
    const ok = !v2.ok && v2.breakages.some((b) => b.index === 4);
    log({ id: 'P10', status: ok ? 'PASS' : 'FAIL', note: `entries=${v1.entries} INTACT first; after tamper: BROKEN=${!v2.ok}, flags_index_4=${v2.breakages.some((b) => b.index === 4)}` });
  } finally {
    fs.writeFileSync(file, original);  // restore
  }
}

async function p11() {
  console.log('═══ P11 — /read path inexistente ═══');
  try {
    const r = await runRead('C:\\carpeta\\que\\no\\existe', { label: 'p11_nonexistent' });
    // Should return ok:false cleanly
    log({ id: 'P11', status: !r.ok ? 'PASS' : 'FAIL', note: `returned ok=${r.ok} cleanly (no crash)` });
  } catch (e: any) {
    log({ id: 'P11', status: 'FAIL', note: `threw: ${e?.message ?? e}` });
  }
}

async function main() {
  for (const fn of [p2, p3, p4, p5, p6, p7, p8, p9, p10, p11]) {
    try { await fn(); }
    catch (e: any) {
      const id = fn.name.toUpperCase();
      log({ id, status: 'FAIL', note: `runner threw: ${e?.message ?? e}` });
    }
  }
  console.log('');
  console.log('═══ ACCEPTANCE SUMMARY ═══');
  for (const r of results) console.log(`${r.id}  ${r.status === 'PASS' ? '✓' : '✗'}  ${r.note}`);
  const passed = results.filter((r) => r.status === 'PASS').length;
  console.log('');
  console.log(`Total: ${passed}/${results.length} passed`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
