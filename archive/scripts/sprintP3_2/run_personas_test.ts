#!/usr/bin/env node
/**
 * Prueba funcional Sprint P3.2 — Persona library (3 → 10).
 *
 * Recorre las 10 personas built-in y demuestra que:
 *   1. Todas cargan vía SHINOBI_SOUL_BUILTIN env.
 *   2. Bodies son visiblemente distintos.
 *   3. Marca verbal distintiva (formality + verbosity + keywords).
 */

import {
  listBuiltinSouls, builtinSoul, loadSoul, personaSystemMessage,
} from '../../src/soul/soul.js';

let failed = 0;
function check(cond: boolean, label: string): void {
  if (cond) console.log(`  ok  ${label}`);
  else { console.log(`  FAIL ${label}`); failed++; }
}

async function main(): Promise<void> {
  console.log('=== Sprint P3.2 — Persona library expandida (10 built-ins) ===');

  console.log('\n--- 1. Lista built-ins ---');
  const list = listBuiltinSouls();
  console.log(`  Total: ${list.length}`);
  console.log(`  Personas: ${list.join(', ')}`);
  check(list.length === 10, '10 personas built-in');
  for (const p of ['default','kawaii','samurai','ronin','monje','kunoichi','oyabun','kohai','sensei','kappa']) {
    check(list.includes(p), `incluye ${p}`);
  }

  console.log('\n--- 2. Cada persona tiene body distintivo ---');
  const bodies = new Map<string, string>();
  for (const p of list) {
    const s = builtinSoul(p)!;
    bodies.set(p, s.body);
    console.log(`  ${p}: ${s.body.split('\n')[0].slice(0, 70)}…`);
  }
  const uniqueBodies = new Set(bodies.values());
  check(uniqueBodies.size === 10, `10 bodies únicos`);

  console.log('\n--- 3. SHINOBI_SOUL_BUILTIN env cambia la persona ---');
  for (const p of list) {
    process.env.SHINOBI_SOUL_BUILTIN = p;
    const s = loadSoul();
    check(s.name === `shinobi-${p}`, `env=${p} → name shinobi-${p}`);
  }
  delete process.env.SHINOBI_SOUL_BUILTIN;

  console.log('\n--- 4. personaSystemMessage es distinto por persona ---');
  const msgs = new Set<string>();
  for (const p of list) {
    msgs.add(personaSystemMessage(builtinSoul(p)!));
  }
  check(msgs.size === 10, '10 system messages distintos');

  console.log('\n--- 5. Formalidad y verbosidad coherentes ---');
  check(builtinSoul('monje')!.formality === 'usted', 'monje habla de usted');
  check(builtinSoul('ronin')!.formality === 'tu', 'ronin tutea');
  check(builtinSoul('ronin')!.verbosity === 'low', 'ronin verbosity=low');
  check(builtinSoul('kohai')!.verbosity === 'high', 'kohai verbosity=high');

  console.log('\n=== Summary ===');
  if (failed > 0) { console.log(`FAIL · ${failed} aserciones`); process.exit(1); }
  console.log('PASS · 10 personas built-in distinguibles, env-switchable');
}

main().catch((e) => {
  console.error('Sprint P3.2 funcional crashed:', e?.stack ?? e);
  process.exit(2);
});
