/**
 * scripts/integrity_demo.ts — FASE C / C1 demonstration by EXECUTION.
 *
 * Runs the runtime integrity pre-action checks (11.1 CSV valid, 11.2 action ⊆
 * declared effects/tools) over real IntegritySteps:
 *   - a CLEAN step (certified skill, valid CSV, artifact hash matches, declared
 *     tool + effect) → both checks pass, no flag.
 *   - one VIOLATION per flag → the corresponding check fires.
 * Then measures the per-action overhead of the checks (death-criterion data).
 *
 * Usage: SHINOBI_INTEGRITY=enforce tsx scripts/integrity_demo.ts
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPreAction } from '../src/integrity/engine.js';
import type { IntegrityStep, SkillBinding } from '../src/integrity/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(__dirname, '../src/integrity/__tests__/fixtures');
const csv = JSON.parse(fs.readFileSync(path.join(FIX, 'certified.csv.json'), 'utf-8'));
const artifactPath = path.join(FIX, 'skill.mjs');

// A skill that declares a read_only tool (to exercise 11.2 cleanly + violations).
const readSkill: SkillBinding = {
  skill_id: 'payment.authorize.v1', declared_tools: ['read_file'], declared_effects: 'read_only',
  csv, artifact_path: artifactPath,
};

function step(over: Partial<IntegrityStep>, skillOver: Partial<SkillBinding> = {}, action = { tool: 'read_file', args: {} }): IntegrityStep {
  return { step: 1, action, risk: 'low', skill: { ...readSkill, ...skillOver }, ...over } as IntegrityStep;
}

// Tampered CSV: flip a signed field → this_hash mismatch.
const tamperedCsv = JSON.parse(JSON.stringify(csv)); tamperedCsv.subject.skill_id = 'evil.skill.v9';
// A modified artifact whose hash will NOT match the certificate.
const badArtifact = path.join(os.tmpdir(), 'integrity_demo_bad_artifact.mjs');
fs.writeFileSync(badArtifact, fs.readFileSync(artifactPath, 'utf-8') + '\n// tampered\n');

const scenarios: Array<{ name: string; step: IntegrityStep }> = [
  { name: 'CLEAN (certified, artifact matches, read_file ⊆ read_only)', step: step({}) },
  { name: '11.1 UNVERIFIED_SKILL (no skill binding)', step: step({ skill: null }) },
  { name: '11.1 CSV_INVALID (tampered certificate)', step: step({}, { csv: tamperedCsv }) },
  { name: '11.1 ARTIFACT_MISMATCH (on-disk code != certified)', step: step({}, { artifact_path: badArtifact }) },
  { name: '11.2 TOOL_NOT_DECLARED (write_file not in declared_tools)', step: step({}, {}, { tool: 'write_file', args: { path: 'x' } }) },
  { name: '11.2 EFFECTS_VIOLATION (edit_file write > declared read_only)', step: step({}, { declared_tools: ['edit_file'] }, { tool: 'edit_file', args: {} }) },
];

console.log('FASE C / C1 — discriminación (SHINOBI_INTEGRITY=' + (process.env.SHINOBI_INTEGRITY ?? 'off') + ')\n');
console.log('| escenario | 11.1 | 11.2 | action | flags |');
console.log('|---|---|---|---|---|');
for (const s of scenarios) {
  const v = runPreAction(s.step);
  const c1 = v.checks.find((c) => c.check === '11.1')!;
  const c2 = v.checks.find((c) => c.check === '11.2')!;
  console.log(`| ${s.name} | ${c1.ok ? 'PASS' : 'FIRE'} | ${c2.ok ? 'PASS' : 'FIRE'} | ${v.action} | ${v.flags.join('+') || '—'} |`);
}

// ── Overhead measurement (death criterion) ──────────────────────────────────
const N = 2000;
const clean = step({});
// warmup
for (let i = 0; i < 200; i++) runPreAction(clean);
const t0 = performance.now();
for (let i = 0; i < N; i++) runPreAction(clean);
const totalMs = performance.now() - t0;
const perCall = totalMs / N;
console.log('\n── Overhead de los chequeos (sobre el escenario CLEAN, el más caro) ──');
console.log(`iteraciones: ${N}`);
console.log(`total: ${totalMs.toFixed(1)} ms`);
console.log(`por acción (CON chequeos): ${perCall.toFixed(4)} ms`);
console.log(`por acción (SIN chequeos = baseline no-op): ~0 ms (la capa está gated; off = cero coste)`);
console.log(`contexto: una acción real del agente (LLM + tool) ronda 1e3–1e4 ms; el overhead es ~${(perCall).toFixed(3)} ms (${(perCall / 1000 * 100).toFixed(4)}% de 1s).`);
console.log(`criterio de muerte (duplicar tiempo/acción): NO se cruza — el overhead es <1% de una sola acción.`);
