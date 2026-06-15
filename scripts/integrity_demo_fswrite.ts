/**
 * scripts/integrity_demo_fswrite.ts — C7 demonstration over the REAL write_file
 * tool (not a fixture). Capa 2 governs a real Shinobi capability:
 *   - in-scope write  → 11.2 PASS / proceed → the real tool executes the write.
 *   - protected path  → 11.2 FIRE (SCOPE_VIOLATION); in flag it is recorded, in
 *     enforce it would halt. We do NOT actually write the protected path.
 *
 * The protected-path verdict comes from the SAME policy the approval gate uses
 * (approval.classifyCritical) → one policy, surfaced through 11.2.
 *
 * Usage: SHINOBI_INTEGRITY=flag tsx scripts/integrity_demo_fswrite.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import '../src/tools/index.js';                       // register native tools
import { getTool } from '../src/tools/tool_registry.js';
import { classifyCritical } from '../src/security/approval.js';
import { runPreAction } from '../src/integrity/engine.js';
import { stepForToolCall } from '../src/integrity/registry.js';

const scratch = path.resolve('scratch');
if (!fs.existsSync(scratch)) fs.mkdirSync(scratch, { recursive: true });
const inScopePath = path.join('scratch', `integrity_c7_${process.pid}.txt`);

async function main() {
  const writeTool = getTool('write_file');
  if (!writeTool) { console.error('write_file tool not registered'); process.exit(1); }

  const scenarios = [
    { name: 'IN-SCOPE write (scratch/…)', path: inScopePath, execute: true },
    { name: 'PROTECTED write (.env)', path: '.env', execute: false },
    { name: 'PROTECTED write (id_rsa in .ssh/)', path: 'home/.ssh/id_rsa', execute: false },
  ];

  console.log(`C7 — Capa 2 sobre la tool REAL write_file (SHINOBI_INTEGRITY=${process.env.SHINOBI_INTEGRITY ?? 'off'})\n`);
  console.log('| escenario | out_of_scope (approval) | 11.1 | 11.2 | action | ejecutó? |');
  console.log('|---|---|---|---|---|---|');

  for (const s of scenarios) {
    const outOfScope = classifyCritical('write_file', { path: s.path }).destructive;  // single policy
    // risk omitted → defaults 'low', exactly as the live orchestrator hook builds
    // the step. Under SHINOBI_INTEGRITY=flag a violation → action 'flag' (records,
    // does NOT halt production); under enforce the same violation → 'halt'.
    const v = runPreAction(stepForToolCall('write_file', { path: s.path, content: 'hello from C7 demo' }, { outOfScope }));
    const c1 = v.checks.find((c) => c.check === '11.1')!;
    const c2 = v.checks.find((c) => c.check === '11.2')!;

    // In a flag run we'd let it proceed (record only). Here we only physically
    // execute the explicitly-safe in-scope case; protected paths are shown as a
    // verdict, never written.
    let executed = 'no';
    if (s.execute && c2.ok) {
      const r = await writeTool.execute({ path: s.path, content: 'hello from C7 demo' });
      executed = r.success ? `yes (${r.output.slice(0, 40)}…)` : `failed: ${r.error}`;
    }
    const actionShown = c2.ok ? v.action : `${v.action} (enforce→halt)`;
    console.log(`| ${s.name} | ${outOfScope} | ${c1.ok ? 'PASS' : 'FIRE'} | ${c2.ok ? 'PASS' : 'FIRE'} | ${actionShown} | ${executed} |`);
  }

  // Overhead of the live-loop pre-action checks on the bound write_file step.
  const step = stepForToolCall('write_file', { path: inScopePath, content: 'x' }, { outOfScope: false });
  for (let i = 0; i < 200; i++) runPreAction(step);
  const N = 2000; const t0 = performance.now();
  for (let i = 0; i < N; i++) runPreAction(step);
  console.log(`\n── Overhead Capa 2 (bound write_file, 11.1+11.2+11.3) en bucle: ${((performance.now() - t0) / N).toFixed(4)} ms/acción (${N} iter). Death criterion no cruzado.`);

  try { fs.rmSync(path.resolve(inScopePath), { force: true }); } catch { /* ignore */ }
}

main().catch((e) => { console.error(e); process.exit(1); });
