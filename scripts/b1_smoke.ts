// B.1 smoke — verifica parseSelfArgs y la rama --diff sin necesitar LLM real.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseSelfArgs } from '../src/reader/self.js';

let pass = 0, fail = 0;
function t(name: string, cond: boolean, hint?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${hint ? ' — ' + hint : ''}`); fail++; }
}

console.log('B.1 — parseSelfArgs');
t('empty → diff false', parseSelfArgs('').diff === false);
t('--diff → diff true', parseSelfArgs('--diff').diff === true);
const ok1 = parseSelfArgs('--diff --budget=20000');
t('--diff + budget', ok1.diff === true && ok1.budgetTokens === 20000);
t('unknown arg → error', parseSelfArgs('foo').error !== undefined);
t('bad budget → error', parseSelfArgs('--budget=abc').error !== undefined);

console.log('');
console.log('B.1 — runSelfDiff (synthetic self_reports)');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b1-'));
const cwdPrev = process.cwd();
process.chdir(tmp);
try {
  const dir = path.join(tmp, 'self_reports');
  fs.mkdirSync(dir);
  const r1 = {
    repo_purpose: 'Original purpose',
    architecture_summary: 'x',
    modules: [{ name: 'a', path: 'a', responsibility: 'r' }],
    entry_points: [{ file: 'a/i.ts', kind: 'cli' }],
    risks: [{ severity: 'low', description: 'old risk' }],
    evidence: { subagent_count: 1, tokens_total: 0, duration_ms: 1, subreports_referenced: 1 },
  };
  const r2 = {
    ...r1,
    repo_purpose: 'New purpose',
    modules: [
      { name: 'a', path: 'a', responsibility: 'r' },
      { name: 'b', path: 'b', responsibility: 'r2' },
    ],
    risks: [{ severity: 'high', description: 'new risk' }],
  };
  fs.writeFileSync(path.join(dir, '2026-01-01.json'), JSON.stringify(r1));
  fs.writeFileSync(path.join(dir, '2026-02-01.json'), JSON.stringify(r2));
  // Re-import to pick up new cwd inside runSelfDiff
  const mod = await import('../src/reader/self.js?fresh=' + Date.now());
  const result = await mod.runSelfDiff();
  t('diff returns ok', result.ok === true);
  t('diff captures repo_purpose change', result.diffs.some((d: any) => d.key === 'repo_purpose' && d.kind === 'changed'));
  t('diff captures added module', result.diffs.some((d: any) => d.kind === 'added' && d.key.startsWith('module:b@')));
  t('diff captures removed risk', result.diffs.some((d: any) => d.kind === 'removed' && d.key.startsWith('risk:low:')));
  t('diff captures added risk', result.diffs.some((d: any) => d.kind === 'added' && d.key.startsWith('risk:high:')));
} finally {
  process.chdir(cwdPrev);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('');
console.log(`Total: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
