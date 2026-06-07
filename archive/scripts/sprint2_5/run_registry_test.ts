#!/usr/bin/env node
/**
 * Prueba funcional Sprint 2.5 — Skill ecosystem maduro.
 *
 * Demuestra el flujo completo del registry público:
 *   1. Pobla un LocalRegistry con 5 skills oficiales firmadas
 *      (interface-design, frontend-design, find-skill, deploy-helper,
 *      test-runner) + una v1.1.0 de test-runner para probar upgrades.
 *   2. Resuelve un plan de instalación con dependencias.
 *   3. Instala 5 skills vía `installFromRegistry`.
 *   4. Hace upgrade de test-runner v1.0.0 → v1.1.0 (backup automático).
 *   5. Hace rollback de test-runner a v1.0.0.
 *   6. Verifica inventory final.
 */

import { existsSync, rmSync, mkdtempSync, readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { LocalRegistry } from '../../src/skills/registry/local_registry.js';
import { installFromRegistry, rollback, getInstalledInventory } from '../../src/skills/registry/installer.js';
import { resolvePlan } from '../../src/skills/registry/dep_resolver.js';
import { verifySkillText } from '../../src/skills/skill_signing.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES = resolve(__dirname, 'fixtures');

let failed = 0;
function check(cond: boolean, label: string, detail?: string): void {
  if (cond) console.log(`  ok  ${label}${detail ? ` · ${detail}` : ''}`);
  else { console.log(`  FAIL ${label}${detail ? ` · ${detail}` : ''}`); failed++; }
}

async function main(): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), 'shinobi-registry-'));
  const skillsRoot = join(work, 'skills');
  console.log('=== Sprint 2.5 — Skill registry público ===');
  console.log(`Skills root: ${skillsRoot}`);

  try {
    const entries = [
      {
        name: 'interface-design', version: '1.0.0',
        description: 'UI mockups + component specs',
        source: join(FIXTURES, 'interface-design'),
        publishedAt: '2026-05-01T00:00:00Z', publishedBy: 'shinobi-team',
      },
      {
        name: 'frontend-design', version: '1.0.0',
        description: 'React/Vue/Svelte component architecture',
        source: join(FIXTURES, 'frontend-design'),
        publishedAt: '2026-05-01T00:00:00Z', publishedBy: 'shinobi-team',
      },
      {
        name: 'find-skill', version: '1.0.0',
        description: 'Meta-skill que busca otras skills',
        source: join(FIXTURES, 'find-skill'),
        publishedAt: '2026-05-01T00:00:00Z', publishedBy: 'shinobi-team',
      },
      {
        name: 'deploy-helper', version: '1.0.0',
        description: 'Deploy checklist + rollback plan',
        source: join(FIXTURES, 'deploy-helper'),
        requires: { 'test-runner': '^1.0.0' },
        publishedAt: '2026-05-01T00:00:00Z', publishedBy: 'shinobi-team',
      },
      {
        name: 'test-runner', version: '1.0.0',
        description: 'Ejecuta y diagnostica suites de tests',
        source: join(FIXTURES, 'test-runner'),
        publishedAt: '2026-05-01T00:00:00Z', publishedBy: 'shinobi-team',
      },
      {
        name: 'test-runner', version: '1.1.0',
        description: 'Test runner v1.1.0 con mejor diagnóstico',
        source: join(FIXTURES, 'test-runner'),
        publishedAt: '2026-05-10T00:00:00Z', publishedBy: 'shinobi-team',
      },
    ];
    const registry = new LocalRegistry(entries);

    // ── Step 1: resolver plan para deploy-helper ──
    console.log('\n--- 1. resolvePlan(deploy-helper) ---');
    const plan = await resolvePlan('deploy-helper', { registry });
    console.log(`  steps: ${plan.steps.map(s => `${s.name}@${s.version}`).join(' → ')}`);
    check(plan.steps.length === 2, 'plan tiene 2 pasos (test-runner luego deploy-helper)');
    check(plan.steps[0].name === 'test-runner', 'test-runner se instala primero');
    check(plan.steps[1].name === 'deploy-helper', 'deploy-helper se instala después');
    check(plan.steps[0].version === '1.1.0', 'resolvió a test-runner v1.1.0 (latest)');

    // ── Step 2: instalar 5 skills (deploy-helper trae test-runner, los otros uno a uno) ──
    console.log('\n--- 2. install 5 skills via registry ---');
    const namesToInstall = ['interface-design', 'frontend-design', 'find-skill', 'deploy-helper'];
    for (const n of namesToInstall) {
      const r = await installFromRegistry(n, registry, { skillsRoot });
      const inst = r.installed.map(i => `${i.name}@${i.version}`).join(', ');
      console.log(`  install ${n}: installed=[${inst}] errors=${r.errors.length} skipped=${r.skipped.length}`);
      check(r.errors.length === 0, `install ${n} sin errores`);
    }
    const inventory1 = getInstalledInventory(skillsRoot);
    console.log(`  inventory: ${JSON.stringify(inventory1)}`);
    check(Object.keys(inventory1).length >= 5, `>= 5 skills instaladas (real: ${Object.keys(inventory1).length})`);

    // Verifica firmas de cada SKILL.md instalado.
    for (const [name, version] of Object.entries(inventory1)) {
      const path = join(skillsRoot, 'approved', `${name}@${version}`, 'SKILL.md');
      if (existsSync(path)) {
        const v = verifySkillText(readFileSync(path, 'utf-8'));
        check(v.valid, `${name}@${version} signature válida`);
      }
    }

    // ── Step 3: simular upgrade test-runner 1.0.0 → 1.1.0 + rollback ──
    // El install batch anterior ya trajo test-runner@1.1.0 como dep de
    // deploy-helper. Para demostrar el flujo upgrade+rollback empezamos
    // fresh con test-runner@1.0.0 instalado deliberadamente.
    console.log('\n--- 3. simular upgrade test-runner 1.0.0 → 1.1.0 ---');
    const cleanRoot = join(work, 'skills-rollback');
    const v1Only = new LocalRegistry([entries.find(e => e.name === 'test-runner' && e.version === '1.0.0')!]);
    const first = await installFromRegistry('test-runner', v1Only, { skillsRoot: cleanRoot });
    console.log(`  install v1.0.0: ${first.installed.map(i => i.name + '@' + i.version).join(', ')}`);
    check(getInstalledInventory(cleanRoot)['test-runner'] === '1.0.0', 'inventory antes del upgrade: 1.0.0');

    const upgrade = await installFromRegistry('test-runner', registry, { skillsRoot: cleanRoot });
    console.log(`  upgrade to latest: ${upgrade.installed.map(i => i.name + '@' + i.version).join(', ')}`);

    const inv2 = getInstalledInventory(cleanRoot);
    check(inv2['test-runner'] === '1.1.0', `test-runner ahora en 1.1.0 (real: ${inv2['test-runner']})`);

    console.log('\n--- 4. rollback test-runner ---');
    const rb = await rollback('test-runner', { skillsRoot: cleanRoot });
    console.log(`  rollback: ok=${rb.ok} · ${rb.message}`);
    check(rb.ok, 'rollback ejecutado');
    check(rb.restoredVersion === '1.0.0', `restaurada v1.0.0 (real: ${rb.restoredVersion})`);

    const inv3 = getInstalledInventory(cleanRoot);
    check(inv3['test-runner'] === '1.0.0', `inventory refleja rollback (real: ${inv3['test-runner']})`);

    // ── Step 4: detección de ciclo ──
    console.log('\n--- 5. detección de ciclo en deps ---');
    const cyclic = new LocalRegistry([
      { name: 'a', version: '1.0.0', description: 'A', source: join(FIXTURES, 'find-skill'), requires: { b: '^1.0.0' } },
      { name: 'b', version: '1.0.0', description: 'B', source: join(FIXTURES, 'find-skill'), requires: { a: '^1.0.0' } },
    ]);
    let cycleError = '';
    try { await resolvePlan('a', { registry: cyclic }); }
    catch (e: any) { cycleError = String(e?.message ?? e); }
    check(/ciclo/.test(cycleError), 'detecta ciclo a→b→a');

    console.log('\n=== Summary ===');
    if (failed > 0) { console.log(`FAIL · ${failed} aserciones`); process.exit(1); }
    console.log('PASS · registry público con install + deps + signing + upgrade + rollback');
  } finally {
    try { if (existsSync(work)) rmSync(work, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => {
  console.error('Registry test crashed:', e?.stack ?? e);
  process.exit(2);
});
