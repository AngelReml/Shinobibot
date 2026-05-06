// Retry P5, P7, P8 only.
import * as fs from 'fs';
import * as path from 'path';
import { runCommittee, findLatestSelfReport } from '../src/committee/cli.js';
import { runLearn } from '../src/knowledge/learn.js';

interface PResult { id: string; status: 'PASS' | 'FAIL'; note: string }
const results: PResult[] = [];
function log(p: PResult) { results.push(p); console.log(`\n[${p.id}] ${p.status} — ${p.note}\n`); }
function fileText(p: string): string { try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; } }

async function p5() {
  console.log('═══ P5 — /committee disenso (retry) ═══');
  const target = findLatestSelfReport();
  if (!target) return log({ id: 'P5', status: 'FAIL', note: 'no self_report' });
  const r = await runCommittee(target);
  if (!r.ok) return log({ id: 'P5', status: 'FAIL', note: 'committee failed' });
  const data = JSON.parse(fileText(r.outputPath));
  const dissents = data?.synthesis?.dissents ?? [];
  log({ id: 'P5', status: dissents.length >= 1 ? 'PASS' : 'FAIL', note: `${dissents.length} dissents detected${dissents.length ? ` (first: "${dissents[0].topic}")` : ''}` });
}

async function p7() {
  console.log('═══ P7 — /learn astro (retry with browser UA) ═══');
  // Clean previous failed knowledge dir to avoid name collision.
  const dir = path.join(process.cwd(), 'knowledge', 'astro');
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  const r = await runLearn('https://docs.astro.build');
  if (!r.ok) return log({ id: 'P7', status: 'FAIL', note: 'learn failed' });
  const manualPath = path.join(process.cwd(), 'knowledge', r.programName, 'manual.json');
  const manual = JSON.parse(fileText(manualPath));
  const txt = JSON.stringify(manual).toLowerCase();
  const concepts = ['component', 'island', 'route', 'static', 'page', 'layout', 'astro'];
  const found = concepts.filter((c) => txt.includes(c));
  const purposeNonGeneric = (manual.purpose ?? '').length > 50 && !/^astro is a framework\.?$/i.test((manual.purpose ?? '').trim());
  log({ id: 'P7', status: found.length >= 2 && purposeNonGeneric ? 'PASS' : 'FAIL', note: `program=${r.programName}, concepts=[${found.join(',')}], purpose_specific=${purposeNonGeneric}` });
}

async function p8() {
  console.log('═══ P8 — KnowledgeRouter usage.log inyecta astro (retry) ═══');
  const { KnowledgeRouter } = await import('../src/knowledge/KnowledgeRouter.js');
  const router = new KnowledgeRouter();
  const logPath = path.join(process.cwd(), 'knowledge', 'usage.log');
  const before = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '';
  const inj = router.buildPromptInjection('Audit task that mentions astro framework integration.', 'P8-mission-retry');
  const after = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '';
  const newLines = after.slice(before.length);
  const ok = inj.text.length > 0 && /"program":\s*"astro"/.test(newLines) && /P8-mission-retry/.test(newLines);
  log({ id: 'P8', status: ok ? 'PASS' : 'FAIL', note: `astro inj ${inj.text.length>0?'YES':'NO'}, log entry recorded=${/P8-mission-retry/.test(newLines)}` });
}

async function main() {
  await p5();
  await p7();
  await p8();
  console.log('');
  console.log('═══ RETRY SUMMARY ═══');
  for (const r of results) console.log(`${r.id}  ${r.status === 'PASS' ? '✓' : '✗'}  ${r.note}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
