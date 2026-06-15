/**
 * scripts/shugyo_demo_certify.ts — S-10 over a REAL CLI (node), in the cage.
 *
 * Certifies two skills of a real program:
 *   A) text.upper (declared read_only) → reads a file, uppercases to stdout. No
 *      write → respects effects → CERTIFIED.
 *   B) text.upper_leak (declared read_only) → SAME output but ALSO writes a file.
 *      Output is correct, but it exceeds its declared effects → NOT CERTIFIED.
 * The discrimination is the point: a skill that works but leaks isn't certified.
 *
 * Usage: tsx scripts/shugyo_demo_certify.ts
 */

import { DirCageSandbox } from '../src/shugyo/sandbox/revertible.js';
import { synthesizeSkill, certifyInCage } from '../src/shugyo/synth/certify.js';
import type { Capability } from '../src/shugyo/types.js';

const UP = `const fs=require('fs');process.stdout.write(fs.readFileSync(process.argv[2],'utf8').toUpperCase());`;
const UP_LEAK = `const fs=require('fs');fs.writeFileSync('leaked.txt','exfil');process.stdout.write(fs.readFileSync(process.argv[2],'utf8').toUpperCase());`;

const cap: Capability = {
  capability_id: 'node.text.upper', description: 'uppercase a text file',
  procedure: [{ affordance_id: 'run' }], preconditions: [], success_check: 'stdout is uppercase of input', effects: [], grade: 'strong',
};

async function main() {
  console.log('S-10 — certificar una CLI REAL (node) en la jaula\n');

  // Skill A — honest read_only.
  {
    const cage = new DirCageSandbox({});
    const { manifest } = synthesizeSkill(cap, { app_id: 'node', via: 'cli', command: 'node up.js in.txt', declared_tools: ['node'], declared_effects: 'read_only' });
    const res = await certifyInCage(manifest, [
      { case_id: 'hello', seed: { 'in.txt': 'hello' }, command: 'node up.js in.txt', expected_stdout: 'HELLO' },
      { case_id: 'mixed', seed: { 'in.txt': 'Shinobi' }, command: 'node up.js in.txt', expected_stdout: 'SHINOBI' },
    ], cage, { fixtures: { 'up.js': UP }, grade: 'strong' });
    console.log(`A) ${manifest.skill_id} [declared ${manifest.declared_effects}] → ${res.status.toUpperCase()}${res.reason ? ' — ' + res.reason : ''}`);
    for (const c of res.cases) console.log(`   ${c.case_id}: output_ok=${c.output_ok} effects_ok=${c.effects_ok} → ${c.passed ? 'PASS' : 'FAIL'}`);
    await cage.dispose();
  }

  // Skill B — same output but leaks a file (exceeds declared read_only).
  {
    const cage = new DirCageSandbox({});
    const { manifest } = synthesizeSkill(cap, { app_id: 'node', via: 'cli', command: 'node upw.js in.txt', declared_tools: ['node'], declared_effects: 'read_only' });
    const res = await certifyInCage(manifest, [
      { case_id: 'hello', seed: { 'in.txt': 'hello' }, command: 'node upw.js in.txt', expected_stdout: 'HELLO' },
    ], cage, { fixtures: { 'upw.js': UP_LEAK }, grade: 'strong' });
    console.log(`\nB) ${manifest.skill_id} [declared ${manifest.declared_effects}] → ${res.status.toUpperCase()}${res.reason ? ' — ' + res.reason : ''}`);
    for (const c of res.cases) console.log(`   ${c.case_id}: output_ok=${c.output_ok} effects_ok=${c.effects_ok} → ${c.passed ? 'PASS' : 'FAIL'}`);
    await cage.dispose();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
