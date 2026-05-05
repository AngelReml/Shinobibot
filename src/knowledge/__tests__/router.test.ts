// C.2 unit test — KnowledgeRouter against synthetic knowledge dir.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { KnowledgeRouter } from '../KnowledgeRouter.js';

let pass = 0, fail = 0;
function t(name: string, cond: boolean, hint?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${hint ? ' — ' + hint : ''}`); fail++; }
}

function makeManual(extra: Partial<any> = {}): any {
  return {
    purpose: 'workflow automation',
    install: 'npm install n8n',
    public_api: [{ name: 'workflow.execute', signature: 'workflow.execute(input)', summary: 'runs a workflow' }],
    usage_patterns: [
      { title: 'webhook trigger', body: 'use the webhook node to start a workflow on HTTP POST.' },
      { title: 'cron trigger', body: 'use the cron node to schedule recurring runs.' },
    ],
    gotchas: ['credentials must be encrypted at rest'],
    examples: [{ title: 'hello', code: 'console.log("hi")' }],
    synonyms: ['n8n.io'],
    source: { kind: 'url', origin: 'https://docs.n8n.io', pages_or_files: 20 },
    ...extra,
  };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'router-'));
fs.mkdirSync(path.join(tmp, 'n8n'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'n8n', 'manual.json'), JSON.stringify(makeManual()));
fs.mkdirSync(path.join(tmp, 'execa'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'execa', 'manual.json'), JSON.stringify(makeManual({
  purpose: 'process execution',
  install: 'npm install execa',
  public_api: [{ name: 'execa', signature: 'execa(file, args)', summary: 'spawn a subprocess' }],
  usage_patterns: [{ title: 'capture stdout', body: 'await execa("ls").stdout' }],
  gotchas: [],
  examples: [],
  synonyms: ['Execa'],
  source: { kind: 'repo', origin: 'https://github.com/sindresorhus/execa', pages_or_files: 5 },
})));

const usageLog = path.join(tmp, 'usage.log');
const router = new KnowledgeRouter({ knowledgeDir: tmp, usageLogPath: usageLog, maxTokens: 4_000 });

console.log('C.2 — KnowledgeRouter');

console.log('detection:');
const r1 = router.route('Write a workflow in n8n that triggers on a webhook and logs the payload.', 'M-1');
t('detects n8n', r1.detected.includes('n8n'));
t('does NOT detect execa (no mention)', !r1.detected.includes('execa'));
t('matched_terms includes n8n', r1.injected[0].matched_terms.includes('n8n'));

console.log('\ncontext injection:');
const inj = router.buildPromptInjection('Use n8n webhook node to capture POST.', 'M-2');
t('injection non-empty', inj.text.length > 0);
t('injection includes BEGIN/END markers', inj.text.includes('BEGIN INJECTED KNOWLEDGE') && inj.text.includes('END INJECTED KNOWLEDGE'));
t('injection includes a webhook section (relevant)', /webhook/i.test(inj.text));

console.log('\nbudget:');
const tinyRouter = new KnowledgeRouter({ knowledgeDir: tmp, usageLogPath: usageLog, maxTokens: 200 });
const r2 = tinyRouter.route('n8n workflow', 'M-3');
t('respects tight budget (injection ≤ 4*maxTokens chars)', r2.injected[0]?.injected_chars !== undefined && r2.injected[0].injected_chars <= 200 * 4);

console.log('\nmulti-program priority:');
const r3 = router.route('Use execa to spawn a process, then send to n8n n8n n8n.', 'M-4');
t('detects both n8n and execa', r3.detected.includes('n8n') && r3.detected.includes('execa'));
t('n8n ranks first (more matches)', r3.injected[0].program === 'n8n');

console.log('\nsynonym matching:');
const r4 = router.route('I prefer n8n.io for automation.', 'M-5');
t('synonym n8n.io triggers n8n manual', r4.detected.includes('n8n'));

console.log('\nlogging:');
t('usage.log file exists', fs.existsSync(usageLog));
const logContent = fs.readFileSync(usageLog, 'utf-8');
t('usage.log records mission_id', logContent.includes('M-1'));
t('usage.log records program name', logContent.includes('"program":"n8n"') || logContent.includes('"program": "n8n"'));

console.log('\nno-match:');
const r5 = router.route('Write some Rust async code.', 'M-6');
t('returns empty injected when nothing matches', r5.injected.length === 0);
const inj2 = router.buildPromptInjection('Write some Rust async code.', 'M-7');
t('buildPromptInjection returns empty string for no match', inj2.text === '');

fs.rmSync(tmp, { recursive: true, force: true });

console.log('');
console.log(`Total: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
