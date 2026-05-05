// C.1 unit test — parser + manual validation (no real network).
import { parseLearnArgs } from '../learn.js';

let pass = 0, fail = 0;
function t(name: string, cond: boolean, hint?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${hint ? ' — ' + hint : ''}`); fail++; }
}

console.log('C.1 — parseLearnArgs');
t('empty → error', parseLearnArgs('').error !== undefined);
t('local path', parseLearnArgs('C:/x/y').input === 'C:/x/y');
t('github url', parseLearnArgs('https://github.com/sindresorhus/execa').input === 'https://github.com/sindresorhus/execa');
t('docs url', parseLearnArgs('https://docs.n8n.io').input === 'https://docs.n8n.io');

console.log('');
console.log(`Total: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
