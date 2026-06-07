#!/usr/bin/env node
/**
 * Prueba funcional Sprint 3.6 — Soul/Alma configurable.
 *
 * Demuestra que el mismo prompt genera respuestas con tono distinto
 * cuando cambia la persona activa.
 *
 * Como la generación real requiere LLM, aquí inspectamos el
 * `personaSystemMessage` que se inyectaría al system prompt para 3
 * personas distintas. Verifica:
 *   - Cada persona produce mensajes system distinguibles.
 *   - El meta incluye name/tone/language/formality/verbosity.
 *   - El body refleja la persona declarada.
 *   - persistencia archivo round-trip funciona.
 */

import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadSoul,
  personaSystemMessage,
  builtinSoul,
  writeSoulToFile,
  listBuiltinSouls,
} from '../../src/soul/soul.js';

let failed = 0;
function check(cond: boolean, label: string, detail?: string): void {
  if (cond) console.log(`  ok  ${label}${detail ? ` · ${detail}` : ''}`);
  else { console.log(`  FAIL ${label}${detail ? ` · ${detail}` : ''}`); failed++; }
}

async function main(): Promise<void> {
  console.log('=== Sprint 3.6 — Soul/Alma configurable ===');
  const workspace = mkdtempSync(join(tmpdir(), 'sprint3_6-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(workspace);
    delete process.env.SHINOBI_SOUL_BUILTIN;
    delete process.env.SHINOBI_SOUL_PATH;

    console.log(`\n--- Builtins disponibles ---`);
    const builtins = listBuiltinSouls();
    console.log(`  ${builtins.join(', ')}`);
    check(builtins.length >= 3, '>= 3 personas built-in');

    console.log('\n--- Persona 1: default ---');
    const d = loadSoul();
    const msgD = personaSystemMessage(d);
    console.log(`  name=${d.name} tone=${d.tone} formality=${d.formality}`);
    console.log(`  body[0]: ${d.body.split('\n')[0]}`);
    check(d.tone === 'sobrio', 'default tone=sobrio');
    check(msgD.includes('tone=sobrio'), 'meta system message tone=sobrio');

    console.log('\n--- Persona 2: kawaii ---');
    process.env.SHINOBI_SOUL_BUILTIN = 'kawaii';
    const k = loadSoul();
    const msgK = personaSystemMessage(k);
    console.log(`  name=${k.name} tone=${k.tone} body[0]: ${k.body.split('\n')[0]}`);
    check(k.tone === 'kawaii', 'kawaii tone=kawaii');
    check(msgK.includes('kawaii'), 'system message refleja kawaii');
    check(msgK !== msgD, 'system messages distintos entre default y kawaii');

    console.log('\n--- Persona 3: samurai (usted, low verbosity) ---');
    process.env.SHINOBI_SOUL_BUILTIN = 'samurai';
    const s = loadSoul();
    const msgS = personaSystemMessage(s);
    console.log(`  name=${s.name} formality=${s.formality} verbosity=${s.verbosity}`);
    check(s.formality === 'usted', 'samurai formality=usted');
    check(s.verbosity === 'low', 'samurai verbosity=low');
    check(msgS.includes('formality=usted'), 'system message indica usted');

    console.log('\n--- Persona 4: custom from file ---');
    delete process.env.SHINOBI_SOUL_BUILTIN;
    const customPath = join(workspace, 'soul.md');
    const minimal = builtinSoul('default')!;
    writeSoulToFile(customPath, {
      ...minimal,
      name: 'shinobi-startup',
      tone: 'casual',
      verbosity: 'high',
      body: 'Eres Shinobi-startup. Modo founder mode: directo, sin filtros, alto volumen.',
    });
    process.env.SHINOBI_SOUL_PATH = customPath;
    const c = loadSoul();
    const msgC = personaSystemMessage(c);
    console.log(`  loaded: name=${c.name} tone=${c.tone} verbosity=${c.verbosity}`);
    check(c.name === 'shinobi-startup', 'custom name cargado del archivo');
    check(c.body.includes('founder mode'), 'custom body presente');
    check(msgC.includes('verbosity=high'), 'system message refleja high verbosity');

    console.log('\n--- Las 4 personas producen system messages distintos ---');
    const all = new Set([msgD, msgK, msgS, msgC]);
    check(all.size === 4, `4 mensajes distintos generados (real: ${all.size})`);

    console.log('\n=== Summary ===');
    if (failed > 0) { console.log(`FAIL · ${failed} aserciones`); process.exit(1); }
    console.log('PASS · 4 personas distinguibles + persistencia archivo + override env');
  } finally {
    process.chdir(originalCwd);
    delete process.env.SHINOBI_SOUL_BUILTIN;
    delete process.env.SHINOBI_SOUL_PATH;
    try { if (existsSync(workspace)) rmSync(workspace, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => {
  console.error('Soul test crashed:', e?.stack ?? e);
  process.exit(2);
});
