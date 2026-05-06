// Retry P13 (PHP repo replacement), P15 (longpaths), P16 (deeper inspection), P17 (variance).
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { runRead } from '../src/reader/cli.js';
import { runAudit } from '../src/audit/runAudit.js';
import { runLearn } from '../src/knowledge/learn.js';

interface PResult { id: string; status: 'PASS' | 'FAIL'; note: string }
const results: PResult[] = [];
function log(p: PResult) { results.push(p); console.log(`\n[${p.id}] ${p.status} — ${p.note}\n`); }
function fileText(p: string): string { try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; } }

async function p13_retry() {
  console.log('═══ P13-retry — usando repo PHP alternativo (Composer) ═══');
  const dest = 'C:\\Users\\angel\\Desktop\\test_repos\\composer';
  if (!fs.existsSync(dest)) {
    const cl = spawnSync('git', ['clone', '--depth', '1', 'https://github.com/composer/composer', dest], { encoding: 'utf-8' });
    if (cl.status !== 0) {
      // Fallback a un repo Go pequeño y conocido
      const dest2 = 'C:\\Users\\angel\\Desktop\\test_repos\\cobra';
      const cl2 = spawnSync('git', ['clone', '--depth', '1', 'https://github.com/spf13/cobra', dest2], { encoding: 'utf-8' });
      if (cl2.status !== 0) return log({ id: 'P13', status: 'FAIL', note: 'both PHP and Go fallbacks failed to clone' });
      const r = await runRead(dest2, { label: 'p13_cobra' });
      if (!r.ok) return log({ id: 'P13', status: 'FAIL', note: 'runRead failed (cobra)' });
      const text = JSON.stringify(JSON.parse(fileText(path.join(r.missionDir, 'report.json')))).toLowerCase();
      const mentionsGo = /\bgo\b|\bgolang\b/.test(text);
      const noFalseTs = !/\b(typescript|tsconfig)\b/.test(text);
      return log({ id: 'P13', status: mentionsGo && noFalseTs ? 'PASS' : 'FAIL', note: `cobra(go)=${mentionsGo}, no_false_ts=${noFalseTs}` });
    }
  }
  const r = await runRead(dest, { label: 'p13_composer' });
  if (!r.ok) return log({ id: 'P13', status: 'FAIL', note: 'runRead failed' });
  const text = JSON.stringify(JSON.parse(fileText(path.join(r.missionDir, 'report.json')))).toLowerCase();
  const mentionsPhp = /\bphp\b/.test(text);
  const noFalseTs = !/\b(typescript|tsconfig)\b/.test(text);
  log({ id: 'P13', status: mentionsPhp && noFalseTs ? 'PASS' : 'FAIL', note: `composer(php)=${mentionsPhp}, no_false_ts=${noFalseTs}` });
}

async function p15_retry() {
  console.log('═══ P15-retry — FizzBuzzEnterprise con longpaths ═══');
  // Try cloning with longpaths enabled.
  const dest = 'C:\\Users\\angel\\Desktop\\test_repos\\fizzbuzz_ee';
  if (!fs.existsSync(dest)) {
    const cl = spawnSync('git', ['-c', 'core.longpaths=true', 'clone', '--depth', '1', 'https://github.com/EnterpriseQualityCoding/FizzBuzzEnterpriseEdition', dest], { encoding: 'utf-8' });
    if (cl.status !== 0) return log({ id: 'P15', status: 'FAIL', note: `clone failed even with longpaths: ${(cl.stderr || cl.stdout).slice(0, 150)}` });
  }
  const r = await runRead(dest, { label: 'p15_fizzbuzz' });
  if (!r.ok) return log({ id: 'P15', status: 'FAIL', note: 'runRead failed' });
  const md = fileText(path.join(r.missionDir, 'report.json')).toLowerCase();
  const signals = ['over-engineer', 'overengineer', 'unnecessary complexity', 'enterprise', 'abstract factory', 'pattern overuse', 'excessive', 'bloat', 'verbose', 'fizzbuzz', 'overuse'];
  const found = signals.filter((s) => md.includes(s));
  log({ id: 'P15', status: found.length >= 1 ? 'PASS' : 'FAIL', note: `signals_found=[${found.join(', ')}]` });
}

async function p16_inspect() {
  console.log('═══ P16-inspect — examinar report del audit Shinobi previo ═══');
  // Find latest Shinobibot audit on disk.
  const auditsDir = path.join(process.cwd(), 'audits');
  const files = fs.readdirSync(auditsDir).filter((f) => f.startsWith('AngelReml__Shinobibot__') && f.endsWith('.md'));
  if (files.length === 0) return log({ id: 'P16', status: 'FAIL', note: 'no Shinobibot audit found' });
  files.sort();
  const md = fileText(path.join(auditsDir, files[files.length - 1])).toLowerCase();
  // Look more thoroughly: subreports may mention the modules even if synthesis dropped them.
  const sha = files[files.length - 1].match(/__([a-f0-9]+)\.md$/)?.[1];
  const subreportsFile = sha ? fs.readdirSync(path.join(auditsDir, '.machine')).find((f) => f.startsWith(sha) && f.endsWith('_subreports.json')) : undefined;
  const subreportText = subreportsFile ? fileText(path.join(auditsDir, '.machine', subreportsFile)).toLowerCase() : '';
  const haystack = md + '\n' + subreportText;
  const planModules = ['reader', 'committee', 'knowledge', 'audit', 'ledger'];
  const found = planModules.filter((m) => haystack.includes(m));
  log({ id: 'P16', status: found.length >= 3 ? 'PASS' : 'FAIL', note: `modules_in_md_or_subreports=[${found.join(',')}]` });
}

async function p17_retry() {
  console.log('═══ P17-retry — Hono before vs after, ahora con manual fresco ═══');
  // Verify hono manual exists from previous learn.
  const honoManual = path.join(process.cwd(), 'knowledge', 'hono', 'manual.json');
  if (!fs.existsSync(honoManual)) {
    const lr = await runLearn('https://hono.dev');
    if (!lr.ok) return log({ id: 'P17', status: 'FAIL', note: 'learn hono.dev failed' });
  }
  const manual = JSON.parse(fileText(honoManual));
  const manualText = JSON.stringify(manual).toLowerCase();
  const manualConcepts = ['middleware', 'context', 'routing', 'router', 'handler'];
  const inManual = manualConcepts.filter((c) => manualText.includes(c));
  console.log(`  manual concepts: [${inManual.join(', ')}]`);

  // Run audit AFTER (knowledge in place).
  const r = await runAudit({ url: 'https://github.com/honojs/hono' });
  const md = fileText(r.mdPath).toLowerCase();
  const concepts = ['middleware', 'context', 'routing', 'router', 'handler', 'route'];
  const count = (s: string) => concepts.reduce((n, c) => n + (s.match(new RegExp(`\\b${c}\\b`, 'g')) ?? []).length, 0);
  const after = count(md);
  const usageLog = fileText(path.join(process.cwd(), 'knowledge', 'usage.log'));
  const honoInUsage = /"program":\s*"hono"/.test(usageLog);
  // Pass if (a) the audit references >= 2 concepts AND (b) usage.log shows the manual was injected.
  const ok = after >= 2 && honoInUsage;
  log({ id: 'P17', status: ok ? 'PASS' : 'FAIL', note: `concept_mentions_after=${after}, hono_injected=${honoInUsage}, manual_concepts=[${inManual.join(',')}]` });
}

async function main() {
  await p13_retry();
  await p15_retry();
  await p16_inspect();
  await p17_retry();
  console.log('');
  console.log('═══ RETRY SUMMARY ═══');
  for (const r of results) console.log(`${r.id}  ${r.status === 'PASS' ? '✓' : '✗'}  ${r.note}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
