// D.3 unit test — runAudit parser + contract validator (no network/LLM).
import { parseAuditCliArgs } from '../runAudit.js';

let pass = 0, fail = 0;
function t(name: string, cond: boolean, hint?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${hint ? ' — ' + hint : ''}`); fail++; }
}

console.log('D.3 — parseAuditCliArgs');
t('rejects without "audit"', parseAuditCliArgs(['foo']).error !== undefined);
t('rejects non-github url', parseAuditCliArgs(['audit', 'https://gitlab.com/x/y']).error !== undefined);
const ok1 = parseAuditCliArgs(['audit', 'https://github.com/sindresorhus/execa']);
t('accepts plain url', ok1.url === 'https://github.com/sindresorhus/execa' && ok1.commit === undefined);
const ok2 = parseAuditCliArgs(['audit', 'https://github.com/o/r', '--commit=abc123', '--budget=20000']);
t('parses --commit and --budget', ok2.commit === 'abc123' && ok2.budgetTokens === 20000);
t('bad budget → error', parseAuditCliArgs(['audit', 'https://github.com/o/r', '--budget=zzz']).error !== undefined);

console.log('');
console.log(`Total: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
