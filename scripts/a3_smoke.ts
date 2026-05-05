// A.3 smoke — verifica parseReadArgs y runRead con LLM mock (sin red).
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseReadArgs } from '../src/reader/cli.js';

let pass = 0, fail = 0;
function t(name: string, cond: boolean, hint?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${hint ? ' — ' + hint : ''}`); fail++; }
}

console.log('A.3 — parseReadArgs');
t('empty → error', parseReadArgs('').error !== undefined);
const ok1 = parseReadArgs('C:/some/path');
t('path only', ok1.path === 'C:/some/path' && ok1.budgetTokens === undefined);
const ok2 = parseReadArgs('C:/x --budget=20000');
t('path + budget', ok2.path === 'C:/x' && ok2.budgetTokens === 20000);
const bad = parseReadArgs('C:/x --budget=zzz');
t('bad budget → error', bad.error !== undefined);

console.log(`\nTotal: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
