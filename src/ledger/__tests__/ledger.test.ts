// D.4 unit tests — MissionLedger hash chain integrity.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MissionLedger } from '../MissionLedger.js';

let pass = 0, fail = 0;
function t(name: string, cond: boolean, hint?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${hint ? ' — ' + hint : ''}`); fail++; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
const ledger = new MissionLedger({ ledgerDir: tmp });

console.log('D.4 — record + verify happy path');
const e1 = ledger.record({ mission_id: 'M-001', input: 'hello', output: 'world', model_calls: 3, total_cost: 0.01 });
t('first entry has empty prev_hash', e1.prev_hash === '');
t('first entry has self_hash', /^[a-f0-9]{64}$/.test(e1.self_hash));
const e2 = ledger.record({ mission_id: 'M-002', input: 'foo', output: 'bar' });
t('second entry prev_hash = first.self_hash', e2.prev_hash === e1.self_hash);
const e3 = ledger.record({ mission_id: 'M-003', input: 'baz', output: 'qux', model_calls: 5, total_cost: 0.05 });
t('third entry prev_hash = second.self_hash', e3.prev_hash === e2.self_hash);
const v = ledger.verify();
t('verify ok with 3 entries', v.ok && v.entries === 3 && v.breakages.length === 0, JSON.stringify(v.breakages));

console.log('\nD.4 — verify catches tampered field (input_hash mutation)');
// Tampering a field WITHOUT recomputing self_hash → local self_hash mismatch only.
const lines = fs.readFileSync(ledger.path, 'utf-8').split(/\n/).filter(Boolean);
const tampered = JSON.parse(lines[1]);
tampered.input_hash = 'ff'.repeat(32);
lines[1] = JSON.stringify(tampered);
fs.writeFileSync(ledger.path, lines.join('\n') + '\n');
const ledger2 = new MissionLedger({ ledgerDir: tmp });
const v2 = ledger2.verify();
t('verify detects tamper (field changed without re-hash)', !v2.ok && v2.breakages.length > 0);
t('breakage flags self_hash mismatch on tampered entry', v2.breakages.some((b) => b.index === 1 && /self_hash mismatch/.test(b.reason)));

console.log('\nD.4 — verify catches forged self_hash (cascade)');
// A more sophisticated attacker rewrites self_hash to make e[1] self-consistent
// but cannot also rewrite e[2].prev_hash without breaking e[2] equally → cascade.
fs.unlinkSync(ledger.path);
const fresh = new MissionLedger({ ledgerDir: tmp });
fresh.record({ mission_id: 'F-1', input: 'a', output: 'b' });
fresh.record({ mission_id: 'F-2', input: 'c', output: 'd' });
fresh.record({ mission_id: 'F-3', input: 'e', output: 'f' });
const fl = fs.readFileSync(fresh.path, 'utf-8').split(/\n/).filter(Boolean);
const forged = JSON.parse(fl[1]);
forged.self_hash = '00'.repeat(32);     // attacker forges a different self_hash on e[1]
fl[1] = JSON.stringify(forged);
fs.writeFileSync(fresh.path, fl.join('\n') + '\n');
const fresh2 = new MissionLedger({ ledgerDir: tmp });
const vForge = fresh2.verify();
t('forged self_hash detected', !vForge.ok);
t('cascade: e[2] prev_hash break flagged',
  vForge.breakages.some((b) => b.index === 2 && /prev_hash break/.test(b.reason)));

console.log('\nD.4 — export produces head + count');
// Reset chain for clean export.
fs.unlinkSync(ledger.path);
const ledger3 = new MissionLedger({ ledgerDir: tmp });
ledger3.record({ mission_id: 'X-1', input: 'a', output: 'b' });
ledger3.record({ mission_id: 'X-2', input: 'c', output: 'd' });
const exp = ledger3.export();
t('export count matches', exp.count === 2);
t('export head equals tail.self_hash', exp.head === ledger3.tail()!.self_hash);

console.log('\nD.4 — gate rehearsal: 10 entries, chain integra');
fs.unlinkSync(ledger.path);
const big = new MissionLedger({ ledgerDir: tmp });
for (let i = 0; i < 10; i++) {
  big.record({ mission_id: `R-${i.toString().padStart(2, '0')}`, input: `in-${i}`, output: `out-${i}`, model_calls: i, total_cost: i * 0.001 });
}
const vBig = big.verify();
t('10 entries verify ok', vBig.ok && vBig.entries === 10);
t('count() returns 10', big.count() === 10);

fs.rmSync(tmp, { recursive: true, force: true });

console.log('');
console.log(`Total: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
