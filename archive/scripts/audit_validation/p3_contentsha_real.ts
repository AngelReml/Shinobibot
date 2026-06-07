/**
 * Validación REAL del fix #8 — verificación de contentSha256 en el
 * installer del registry de skills (análogo a C10).
 *
 * Monta un skill local real, un registry stub, e instala:
 *   - con el contentSha256 correcto -> install aceptada.
 *   - con un contentSha256 manipulado -> install RECHAZADA y dst eliminado.
 *
 * Run: npx tsx scripts/audit_validation/p3_contentsha_real.ts
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import { installFromRegistry } from '../../src/skills/registry/installer.js';
import type { SkillRegistry, SkillManifestEntry } from '../../src/skills/registry/types.js';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

const SKILL_MD = `---
name: probe-skill
version: 1.0.0
description: skill de prueba para validar contentSha256
---
# Probe Skill
Resume el texto que se le pase como entrada.
`;

function makeRegistry(entry: SkillManifestEntry): SkillRegistry {
  return {
    async list() { return [entry]; },
    async resolveLatest(name) { return name === entry.name ? entry : null; },
    async resolveVersion(name, version) {
      return name === entry.name && version === entry.version ? entry : null;
    },
  };
}

async function main() {
  // Skill local real.
  const skillDir = mkdtempSync(join(tmpdir(), 'shinobi-skill-'));
  writeFileSync(join(skillDir, 'SKILL.md'), SKILL_MD, 'utf-8');
  const realHash = createHash('sha256').update(readFileSync(join(skillDir, 'SKILL.md'))).digest('hex');
  console.log(`SKILL.md real sha256 = ${realHash.slice(0, 16)}…`);

  const base: SkillManifestEntry = {
    name: 'probe-skill', version: '1.0.0', description: 'probe',
    source: 'file://' + skillDir,
  };

  // 1. contentSha256 correcto -> instala.
  console.log('\n=== 1. contentSha256 correcto ===');
  const root1 = mkdtempSync(join(tmpdir(), 'shinobi-sr1-'));
  const r1 = await installFromRegistry('probe-skill',
    makeRegistry({ ...base, contentSha256: realHash }), { skillsRoot: root1 });
  console.log(`  installed=${r1.installed.length} errors=${JSON.stringify(r1.errors)}`);
  check('install con hash correcto se acepta', r1.installed.length === 1 && r1.errors.length === 0,
    r1.installed.length === 1 ? 'aceptada' : 'NO instalada');

  // 2. contentSha256 manipulado -> rechaza.
  console.log('\n=== 2. contentSha256 manipulado ===');
  const root2 = mkdtempSync(join(tmpdir(), 'shinobi-sr2-'));
  const badHash = 'deadbeef'.repeat(8);
  const r2 = await installFromRegistry('probe-skill',
    makeRegistry({ ...base, contentSha256: badHash }), { skillsRoot: root2 });
  const rejected = r2.installed.length === 0
    && r2.errors.some((e) => /contentSha256 mismatch/i.test(e.error));
  console.log(`  installed=${r2.installed.length} errors=${JSON.stringify(r2.errors)}`);
  check('install con hash manipulado se RECHAZA', rejected, rejected ? 'mismatch detectado' : 'NO rechazado');

  // 3. el directorio instalado se elimina tras el rechazo.
  const leftover = existsSync(join(root2, 'approved', 'probe-skill@1.0.0'));
  check('el dst se elimina tras el rechazo', !leftover, leftover ? 'dst presente' : 'dst limpiado');

  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
