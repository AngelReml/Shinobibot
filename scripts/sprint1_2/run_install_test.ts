#!/usr/bin/env node
/**
 * Prueba funcional Sprint 1.2 — Anthropic Skills installer.
 *
 * Recorre las 5 skills fixture (`scripts/sprint1_2/fixtures/`) y las
 * instala vía `installSkillFromSource`. Verifica que:
 *
 *   1. Las 4 legítimas (interface-design, frontend-design, find-skill,
 *      superpowers) se aceptan con verdict `clean` y quedan firmadas
 *      en `<tmp>/skills/approved/<name>/SKILL.md` con `signature_hash`
 *      válido.
 *
 *   2. `superpowers` detecta su sub-skill `web-research` y la lista en
 *      `result.subSkills`.
 *
 *   3. `malicious_skill` (renombrada "helpful-cleaner" para parecerse a
 *      la realidad) se rechaza con verdict `critical`, NO se copia a
 *      `approved/`, y aparece registrada en
 *      `<tmp>/audits/skills_registry.jsonl` con `accepted: false`.
 *
 * Exit code 0 si todas las aserciones pasan; 1 si alguna falla.
 */

import { existsSync, readFileSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { installSkillFromSource, formatInstallResult } from '../../src/skills/anthropic_skill_installer.js';
import { verifySkillText } from '../../src/skills/skill_signing.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES = resolve(__dirname, 'fixtures');

interface Case {
  fixture: string;
  expectAccepted: boolean;
  expectVerdict: 'clean' | 'warning' | 'critical';
  expectSubSkills?: string[];
  description: string;
}

const CASES: Case[] = [
  { fixture: 'interface_design', expectAccepted: true,  expectVerdict: 'clean',    description: 'Interface Design (legitimate)' },
  { fixture: 'frontend_design',  expectAccepted: true,  expectVerdict: 'clean',    description: 'Frontend Design (legitimate)' },
  { fixture: 'find_skill',       expectAccepted: true,  expectVerdict: 'clean',    description: 'Find Skill (legitimate)' },
  { fixture: 'superpowers',      expectAccepted: true,  expectVerdict: 'clean',    expectSubSkills: ['web_research'], description: 'Superpowers with sub-skill' },
  { fixture: 'malicious_skill',  expectAccepted: false, expectVerdict: 'critical', description: 'Malicious "helpful-cleaner" (rm -rf $HOME, exfil curl, eval, Stop-Process)' },
];

interface AssertionLog { ok: boolean; label: string; detail?: string; }

function pass(label: string, detail?: string): AssertionLog {
  console.log(`  ok  ${label}${detail ? ` · ${detail}` : ''}`);
  return { ok: true, label, detail };
}
function fail(label: string, detail?: string): AssertionLog {
  console.log(`  FAIL ${label}${detail ? ` · ${detail}` : ''}`);
  return { ok: false, label, detail };
}

async function runCase(c: Case, skillsRoot: string): Promise<AssertionLog[]> {
  const fixturePath = join(FIXTURES, c.fixture);
  console.log(`\n--- ${c.description} (${c.fixture}) ---`);
  const log: AssertionLog[] = [];

  try {
    const r = await installSkillFromSource(fixturePath, { skillsRoot });
    console.log(formatInstallResult(r).split('\n').map(l => '  ' + l).join('\n'));

    if (r.audit.verdict === c.expectVerdict) {
      log.push(pass('verdict matches expected', c.expectVerdict));
    } else {
      log.push(fail('verdict mismatch', `expected ${c.expectVerdict} got ${r.audit.verdict}`));
    }

    if (r.accepted === c.expectAccepted) {
      log.push(pass('accepted flag matches', String(c.expectAccepted)));
    } else {
      log.push(fail('accepted flag mismatch', `expected ${c.expectAccepted} got ${r.accepted}`));
    }

    if (c.expectSubSkills && c.expectSubSkills.length > 0) {
      const ok = c.expectSubSkills.every(s => r.subSkills.includes(s));
      log.push(ok ? pass('sub-skills detected', r.subSkills.join(',')) : fail('sub-skills missing', `expected ${c.expectSubSkills} got ${r.subSkills}`));
    }

    if (c.expectAccepted) {
      // Verificar firma y que existe en approved.
      const dst = r.destination!;
      const skillMd = join(dst, 'SKILL.md');
      if (existsSync(skillMd)) {
        const v = verifySkillText(readFileSync(skillMd, 'utf-8'));
        log.push(v.valid ? pass('SKILL.md signature valid') : fail('SKILL.md signature invalid', v.reason));
      } else {
        log.push(fail('SKILL.md missing at destination', dst));
      }
    } else {
      // Verificar que NO se copió.
      const approvedDir = join(skillsRoot, 'approved');
      if (existsSync(approvedDir)) {
        const entries = readdirSync(approvedDir);
        const polluted = entries.find(e => e.includes(c.fixture.replace('_', '-')) || e === 'helpful-cleaner');
        if (polluted) {
          log.push(fail('rejected skill leaked to approved/', polluted));
        } else {
          log.push(pass('rejected skill NOT in approved/'));
        }
      } else {
        log.push(pass('approved/ does not exist (clean state)'));
      }
    }
  } catch (e: any) {
    log.push(fail('installer threw exception', String(e?.message ?? e)));
  }
  return log;
}

async function main(): Promise<void> {
  const tmpDir = join(tmpdir(), `shinobi-skill-install-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  const skillsRoot = join(tmpDir, 'skills');

  console.log('=== Sprint 1.2 — Anthropic Skills installer ===');
  console.log(`Fixtures:  ${FIXTURES}`);
  console.log(`Sandbox:   ${tmpDir}`);

  const allLogs: AssertionLog[] = [];
  for (const c of CASES) {
    const logs = await runCase(c, skillsRoot);
    allLogs.push(...logs);
  }

  console.log('\n=== Registry contents ===');
  const registry = join(tmpDir, 'audits', 'skills_registry.jsonl');
  if (existsSync(registry)) {
    const lines = readFileSync(registry, 'utf-8').split('\n').filter(Boolean);
    console.log(`${lines.length} entries`);
    for (const l of lines) {
      const j = JSON.parse(l);
      console.log(`  ${j.ts}  ${j.name.padEnd(20)}  verdict=${j.verdict.padEnd(8)}  accepted=${j.accepted}`);
    }
    if (lines.length === CASES.length) {
      allLogs.push(pass(`registry has ${lines.length} entries (one per case)`));
    } else {
      allLogs.push(fail(`registry has ${lines.length} entries, expected ${CASES.length}`));
    }
  } else {
    allLogs.push(fail('registry file missing', registry));
  }

  const failed = allLogs.filter(a => !a.ok);
  console.log(`\n=== Summary ===`);
  console.log(`Assertions: ${allLogs.length - failed.length}/${allLogs.length} passed`);
  for (const f of failed) console.log(`  FAIL · ${f.label} · ${f.detail ?? ''}`);

  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Install test crashed:', e?.stack ?? e);
  process.exit(2);
});
