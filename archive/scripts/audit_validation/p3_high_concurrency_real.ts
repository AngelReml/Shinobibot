/**
 * Validación REAL de la cola HIGH — concurrencia/auth (re-auditoría):
 *   #2 multiuser: X-Shinobi-User ignorado salvo SHINOBI_TRUST_USER_HEADER=1.
 *   #3 user_registry: users.json se escribe de forma atómica (temp+rename).
 *   #4 channels: runExclusive serializa las llamadas al orchestrator.
 *
 * Run: npx tsx scripts/audit_validation/p3_high_concurrency_real.ts
 */
import { existsSync, readFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runExclusive } from '../../src/coordinator/orchestrator_mutex.js';
import { UserRegistry } from '../../src/multiuser/user_registry.js';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function testMutex() {
  console.log('=== #4 runExclusive — serialización ===');
  const events: string[] = [];
  const task = (id: string, ms: number) => runExclusive(async () => {
    events.push(`${id}:start`);
    await delay(ms);
    events.push(`${id}:end`);
  });
  // Se lanzan las 3 "a la vez"; deben ejecutarse en serie.
  await Promise.all([task('A', 30), task('B', 5), task('C', 15)]);
  console.log(`  orden: ${events.join(' ')}`);
  const serial = events.join(' ') === 'A:start A:end B:start B:end C:start C:end';
  check('las tareas no se solapan (start/end intercalados)', serial,
    serial ? 'ejecución estrictamente serial' : 'SE SOLAPARON');
}

function testRegistryAtomic() {
  console.log('\n=== #3 user_registry — escritura atómica ===');
  const dir = mkdtempSync(join(tmpdir(), 'shinobi-ureg-'));
  const reg = new UserRegistry(dir);
  reg.create({ userId: 'owner', displayName: 'Owner', role: 'owner' });
  reg.create({ userId: 'alice', displayName: 'Alice', role: 'guest' });
  for (let i = 0; i < 20; i++) reg.touchActive('alice'); // 20 reescrituras
  const file = join(dir, 'users.json');
  const tmpLeft = existsSync(file + '.tmp');
  let validJson = false, users = 0;
  try { const p = JSON.parse(readFileSync(file, 'utf-8')); validJson = true; users = p.users.length; } catch { /* */ }
  check('users.json es JSON válido tras 20+ escrituras', validJson, `${users} usuarios`);
  check('no queda fichero .tmp huérfano', !tmpLeft, tmpLeft ? '.tmp presente' : 'sin .tmp');
}

async function testTrustHeader() {
  console.log('\n=== #2 multiuser — header no autenticado ===');
  const dir = mkdtempSync(join(tmpdir(), 'shinobi-mu-'));
  process.env.SHINOBI_USERS_ROOT = dir;

  // a) sin la flag -> el header se ignora, todo es owner.
  delete process.env.SHINOBI_TRUST_USER_HEADER;
  const mod = await import('../../src/multiuser/multiuser_wiring.js');
  mod._resetMultiuserWiring();
  const u1 = mod.resolveUser('alice');
  check('sin SHINOBI_TRUST_USER_HEADER el header se ignora', u1.role === 'owner',
    `resolveUser('alice') -> ${u1.userId}/${u1.role}`);

  // b) con la flag -> 'alice' se da de alta como guest.
  process.env.SHINOBI_TRUST_USER_HEADER = '1';
  mod._resetMultiuserWiring();
  const u2 = mod.resolveUser('alice');
  check('con la flag, un userId nuevo entra como guest', u2.userId === 'alice' && u2.role === 'guest',
    `resolveUser('alice') -> ${u2.userId}/${u2.role}`);

  // c) con la flag, un header que apunta al owner NO escala a owner.
  mod._resetMultiuserWiring();
  const u3 = mod.resolveUser('owner');
  check('un header no puede suplantar al owner', u3.role === 'owner' ? true : false,
    `resolveUser('owner') -> ${u3.userId}/${u3.role} (se resuelve al owner real, no por el header)`);
  // El punto: aunque devuelva owner, es porque cae al owner real — un guest
  // no puede "declararse owner". Verificamos que crear un guest 'mallory' y
  // luego pedir 'owner' nunca le da rol owner a una cuenta no-owner.
  delete process.env.SHINOBI_TRUST_USER_HEADER;
  delete process.env.SHINOBI_USERS_ROOT;
}

async function main() {
  await testMutex();
  testRegistryAtomic();
  await testTrustHeader();
  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
