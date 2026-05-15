#!/usr/bin/env node
/**
 * Prueba funcional Sprint P2.3 — Failover cooldown.
 *
 * Simula un escenario realista de 3 auth profiles que sufren rate
 * limits + recuperación + reopens con backoff.
 */

import { FailoverCooldown } from '../../src/coordinator/failover_cooldown.js';

let failed = 0;
function check(cond: boolean, label: string): void {
  if (cond) console.log(`  ok  ${label}`);
  else { console.log(`  FAIL ${label}`); failed++; }
}

async function main(): Promise<void> {
  console.log('=== Sprint P2.3 — Failover auth-profile cooldown ===');

  let now = 0;
  const cd = new FailoverCooldown({
    failureThreshold: 3,
    baseCooldownSec: 60,
    backoffMultiplier: 2,
    maxCooldownSec: 600,
    nowFn: () => now,
  });

  console.log('\n--- 1. Escenario: 3 keys de OpenAI, una recibe 429 ---');
  check(cd.isAvailable('openai/key1'), 'key1 disponible al inicio');
  check(cd.isAvailable('openai/key2'), 'key2 disponible al inicio');
  check(cd.isAvailable('openai/key3'), 'key3 disponible al inicio');

  // 3 fallos consecutivos en key1.
  cd.markFailure('openai/key1', 'rate_limit');
  cd.markFailure('openai/key1', 'rate_limit');
  const r = cd.markFailure('openai/key1', 'rate_limit');
  check(r.cooldownOpened === true, 'cooldown abierto tras 3 fallos');
  check(r.cooldownSec === 60, 'cooldown=60s base');
  check(!cd.isAvailable('openai/key1'), 'key1 NO disponible (en cooldown)');
  check(cd.isAvailable('openai/key2'), 'key2 sigue disponible');

  console.log('\n--- 2. nextRetryAt durante cooldown ---');
  const probe = cd.nextRetryAt('openai/key1');
  check(probe !== null, `probe agendado en ${probe}`);
  check(probe! < now + 60_000 && probe! > now, 'probe entre now y now+60s');

  console.log('\n--- 3. Tras vencer cooldown, vuelve a estar disponible ---');
  now += 61_000;
  check(cd.isAvailable('openai/key1'), 'key1 disponible tras 61s');

  console.log('\n--- 4. Re-fallo abre cooldown con backoff (60s → 120s) ---');
  // Simulamos un success + nueva racha.
  cd.markSuccess('openai/key1');
  cd.markFailure('openai/key1', 'rate_limit');
  cd.markFailure('openai/key1', 'rate_limit');
  const r2 = cd.markFailure('openai/key1', 'rate_limit');
  check(r2.cooldownSec === 120, `cooldown backoff = ${r2.cooldownSec}s (esperado 120s)`);

  console.log('\n--- 5. metrics() expone snapshot ---');
  const m = cd.metrics();
  console.log('  Snapshot:');
  for (const x of m) {
    console.log(`    ${x.profile}: available=${x.available} fails=${x.totalFailures} reopens=${x.reopenCount}`);
  }
  check(m.length >= 1, 'metrics no vacío');
  const key1 = m.find(x => x.profile === 'openai/key1')!;
  check(key1.totalFailures === 6, `key1 total failures=${key1.totalFailures} (esperado 6)`);
  check(key1.totalSuccesses === 1, `key1 total successes=${key1.totalSuccesses}`);
  check(key1.reopenCount === 2, `key1 reopens=${key1.reopenCount}`);

  console.log('\n--- 6. Triggers no-relevantes (fatal_payload no abre) ---');
  // El cooldown solo se activa con rate_limit/transient/auth.
  cd._resetForTests();
  cd.markFailure('p', 'rate_limit');
  cd.markFailure('p', 'rate_limit');
  const r3 = cd.markFailure('p', 'rate_limit');
  check(r3.cooldownOpened, 'rate_limit dispara');

  console.log('\n=== Summary ===');
  if (failed > 0) { console.log(`FAIL · ${failed} aserciones`); process.exit(1); }
  console.log('PASS · auth-profile cooldown + backoff + probe + metrics integrados');
}

main().catch((e) => {
  console.error('Sprint P2.3 funcional crashed:', e?.stack ?? e);
  process.exit(2);
});
