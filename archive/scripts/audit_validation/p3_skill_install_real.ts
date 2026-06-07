/**
 * Validación REAL del comando /skill install (cadena federada cableada).
 * Ejercita runSkillInstall en sus modos reales:
 *   1. fuente directa file:// -> instala.
 *   2. nombre contra un registry.json local -> instala.
 *   3. nombre inexistente en el registry -> error limpio.
 *   4. nombre sin registry configurado -> mensaje claro.
 *
 * Run: npx tsx scripts/audit_validation/p3_skill_install_real.ts
 */
import { mkdtempSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runSkillInstall } from '../../src/skills/registry/install_command.js';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

const SKILL_MD = `---
name: demo-install
version: 2.0.0
description: skill de prueba para /skill install
---
# Demo Install
Resume el texto que se le pase como entrada.
`;

async function main() {
  // Skill local real.
  const skillDir = mkdtempSync(join(tmpdir(), 'shinobi-si-skill-'));
  writeFileSync(join(skillDir, 'SKILL.md'), SKILL_MD, 'utf-8');

  // 1. Fuente directa file://.
  console.log('=== 1. fuente directa file:// ===');
  const root1 = mkdtempSync(join(tmpdir(), 'shinobi-si-r1-'));
  const o1 = await runSkillInstall('file://' + skillDir, { skillsRoot: root1 });
  o1.lines.forEach((l) => console.log('  ' + l));
  const installed1 = existsSync(join(root1, 'approved'));
  check('install desde file:// funciona', o1.ok && installed1, o1.ok ? 'instalada' : 'NO instalada');

  // 2. Nombre contra un registry.json local.
  console.log('\n=== 2. nombre contra registry.json ===');
  const regDir = mkdtempSync(join(tmpdir(), 'shinobi-si-reg-'));
  const regFile = join(regDir, 'registry.json');
  writeFileSync(regFile, JSON.stringify({
    entries: [{
      name: 'demo-install', version: '2.0.0',
      description: 'demo', source: 'file://' + skillDir,
    }],
  }), 'utf-8');
  process.env.SHINOBI_SKILL_REGISTRY = regFile;
  const root2 = mkdtempSync(join(tmpdir(), 'shinobi-si-r2-'));
  const o2 = await runSkillInstall('demo-install', { skillsRoot: root2 });
  o2.lines.forEach((l) => console.log('  ' + l));
  check('install por nombre contra el registry funciona', o2.ok, o2.ok ? 'instalada' : 'NO instalada');

  // 3. Nombre inexistente.
  console.log('\n=== 3. nombre inexistente ===');
  const root3 = mkdtempSync(join(tmpdir(), 'shinobi-si-r3-'));
  const o3 = await runSkillInstall('no-existe-esta-skill', { skillsRoot: root3 });
  o3.lines.forEach((l) => console.log('  ' + l));
  check('una skill inexistente da error limpio (no crash)', !o3.ok && o3.lines.length > 0,
    'error reportado sin excepción');

  // 4. Sin registry configurado.
  console.log('\n=== 4. nombre sin registry configurado ===');
  delete process.env.SHINOBI_SKILL_REGISTRY;
  const root4 = mkdtempSync(join(tmpdir(), 'shinobi-si-r4-'));
  const o4 = await runSkillInstall('alguna-skill', { skillsRoot: root4 });
  o4.lines.forEach((l) => console.log('  ' + l));
  const helpful = !o4.ok && o4.lines.some((l) => /SHINOBI_SKILL_REGISTRY/.test(l));
  check('sin registry, el mensaje explica cómo configurarlo', helpful, 'mensaje accionable');

  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
