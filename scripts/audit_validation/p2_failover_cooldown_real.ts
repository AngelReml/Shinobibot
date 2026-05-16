/**
 * Validación REAL del cableado P2 de failover_cooldown.
 *   1. FailoverCooldown: tras 3 fallos abre cooldown; markSuccess lo cierra.
 *   2. provider_router: un provider en cooldown se SALTA en la cadena de
 *      failover de una llamada LLM real.
 *
 * Hace una llamada LLM real (autorizado). Run:
 *   npx tsx scripts/audit_validation/p2_failover_cooldown_real.ts
 */
import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env'), override: true });

import { FailoverCooldown } from '../../src/coordinator/failover_cooldown.js';
import { invokeLLM, failoverCooldown } from '../../src/providers/provider_router.js';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

async function main() {
  // ── 1. FailoverCooldown determinista ──────────────────────────────────
  console.log('=== 1. FailoverCooldown (clase) ===');
  const cd = new FailoverCooldown({ baseCooldownSec: 60, failureThreshold: 3 });
  check('disponible al inicio', cd.isAvailable('groq/k') === true, 'sin fallos -> available');
  cd.markFailure('groq/k', 'rate_limit');
  cd.markFailure('groq/k', 'rate_limit');
  check('aun disponible tras 2 fallos (< threshold)', cd.isAvailable('groq/k') === true, 'streak 2');
  const r3 = cd.markFailure('groq/k', 'rate_limit');
  check('cooldown abre al 3er fallo', r3.cooldownOpened === true && !cd.isAvailable('groq/k'), `cooldown ${r3.cooldownSec}s`);
  cd.markSuccess('groq/k');
  check('markSuccess cierra el cooldown', cd.isAvailable('groq/k') === true, 'available de nuevo');

  // ── 2. provider_router salta el provider en cooldown ──────────────────
  console.log('\n=== 2. provider_router salta provider en cooldown ===');
  // Abre el cooldown de groq en el singleton del router.
  const routerCd = failoverCooldown();
  routerCd.markFailure('groq', 'rate_limit');
  routerCd.markFailure('groq', 'rate_limit');
  routerCd.markFailure('groq', 'rate_limit');
  console.log(`  groq en cooldown del router: isAvailable=${routerCd.isAvailable('groq')}`);
  check('groq queda en cooldown en el router', routerCd.isAvailable('groq') === false, 'tras 3 markFailure');

  // Llama al LLM forzando la cadena desde groq y captura el log.
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...a: any[]) => { logs.push(a.join(' ')); };
  let resp: any;
  try {
    resp = await invokeLLM(
      { messages: [{ role: 'user', content: 'Responde: PONG' }], temperature: 0, max_tokens: 16 } as any,
      { provider: 'groq' as any },
    );
  } finally {
    console.log = origLog;
  }
  const skippedLog = logs.find((l) => l.includes('cooldown') && l.includes('groq'));
  console.log(`  log del router: ${skippedLog ?? '(no encontrado)'}`);
  console.log(`  llamada LLM: success=${resp?.success}`);
  check('el router salta groq por cooldown', !!skippedLog, 'log "Providers en cooldown, saltados: groq"');
  check('la llamada LLM aun resuelve por failover a otro provider', resp?.success === true,
    'al saltar groq, otro provider responde');

  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
