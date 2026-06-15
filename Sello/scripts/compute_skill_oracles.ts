/**
 * scripts/compute_skill_oracles.ts — compute a skill bank's oracle_output BY CODE
 * (CONTRACT §10/§4). "Ningún oracle se confía a mano."
 *
 * For each case we derive the correct output from the skill's POLICY (an
 * independent encoding of the contract spec — NOT the skill's own implementation,
 * so a buggy skill diverges from the oracle and the grader catches it). We then
 * sanity-check the oracle by running it through the REAL json_schema grader and
 * requiring PASS; only then is it written. Only oracle_fields (manifest) are
 * asserted — free_fields (e.g. prose `detail`) are intentionally excluded.
 *
 * Usage: tsx scripts/compute_skill_oracles.ts skills/payment.authorize.v1
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadBank, type BankTask } from '../src/harness/bank.ts';
import { getGrader } from '../src/graders/index.ts';
import type { Grader } from '../src/graders/types.ts';
import { loadManifest } from '../src/skill/manifest.ts';

const skillDir = process.argv[2] ?? 'skills/payment.authorize.v1';

// ── Per-skill reference policies (owned by Claude Code; spec-derived) ────────
type RefFn = (scenario: any) => Record<string, unknown>;

const REFERENCE_POLICIES: Record<string, RefFn> = {
  // payment.authorize.v1 — reject EXCEEDS_PER_TX, then EXCEEDS_DAILY, else OK.
  'payment.authorize.v1': (s) => {
    const maxTx = s.authorized_max_per_tx_usd;
    const perDay = s.authorized_per_day_usd;
    const spent = s.today_spent_usd;
    const amt = s.amount_usd;
    let authorize: boolean, reason_code: string;
    if (amt > maxTx) { authorize = false; reason_code = 'EXCEEDS_PER_TX'; }
    else if (spent + amt > perDay) { authorize = false; reason_code = 'EXCEEDS_DAILY'; }
    else { authorize = true; reason_code = 'OK'; }
    const remaining_daily_after_tx_usd = authorize ? perDay - (spent + amt) : perDay - spent;
    return { authorize, reason_code, remaining_daily_after_tx_usd };
  },

  // fs.write.v1 — allow write iff path is NOT protected (mirrors Shinobi's
  // approval CRITICAL_PATH_PATTERNS; a drift-guard test in shinobibot pins them).
  'fs.write.v1': (s) => {
    const protectedPatterns = [
      /[a-z]:\\Windows\\System32/i, /[a-z]:\\Windows(\\|$)/i, /[a-z]:\\Program Files/i,
      /\\\.git\\(objects|refs|HEAD)/i, /(^|[\\/])\.env$/i, /[\\/]\.ssh[\\/]/i,
      /\.(pem|key|crt|p12|pfx)$/i, /^HKEY_LOCAL_MACHINE/i, /^HKEY_CLASSES_ROOT/i,
    ];
    const p = typeof s.path === 'string' ? s.path : '';
    const allow = !protectedPatterns.some((re) => re.test(p));
    return { allow, reason_code: allow ? 'OK' : 'PROTECTED_PATH' };
  },
};

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}

const skill = loadManifest(skillDir);
const ref = REFERENCE_POLICIES[skill.manifest.skill_id];
if (!ref) throw new Error(`no reference policy for skill_id ${skill.manifest.skill_id}`);

const bank = loadBank(skill.bankPath);
const failures: string[] = [];
let ok = 0;

for (const task of bank as BankTask[]) {
  const scenario = (task.input as any).scenario ?? task.input;
  const full = ref(scenario);
  const oracle = pick(full, skill.manifest.oracle_fields);

  // Sanity: a candidate output carrying the oracle (+ a free `detail`) must PASS
  // its real grader against ground_truth=oracle. A bad/ungradeable oracle never ships.
  const candidate = JSON.stringify({ ...oracle, detail: 'reference candidate' });
  const shim = {
    id: task.task_id,
    grader: { kind: task.grader, config: task.grader_config } as unknown as Grader,
    ground_truth: { expected: oracle },
  };
  const res = getGrader(task.grader).grade(candidate, shim);
  if (res.verdict !== 'PASS') {
    failures.push(`${task.task_id} → ${res.verdict}: ${res.details}`);
    continue;
  }
  task.oracle_output = oracle;
  ok++;
}

if (failures.length > 0) {
  console.error(`✖ ${failures.length} oracle(s) did NOT pass their real grader:`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}

fs.writeFileSync(skill.bankPath, bank.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
console.log(`✓ computed + validated ${ok}/${bank.length} skill oracles against the real grader`);
console.log(`  oracle_fields asserted: [${skill.manifest.oracle_fields.join(', ')}]`);
console.log(`  free_fields excluded:   [${skill.manifest.free_fields.join(', ')}]`);
console.log(`  wrote → ${path.relative(process.cwd(), skill.bankPath)}`);
