/**
 * Validación REAL del cableado P2 de multiuser.
 * Ejercita resolveUser (alta on-first-contact contra el UserRegistry real)
 * y las políticas de aislamiento (scopedPath, canActOn) con un registry real
 * en un directorio temporal.
 *
 * Run: npx tsx scripts/audit_validation/p2_multiuser_real.ts
 */
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

async function main() {
  const work = mkdtempSync(join(tmpdir(), 'shinobi-mu-'));
  process.env.SHINOBI_USERS_ROOT = join(work, 'users');
  const { userRegistry, resolveUser } = await import('../../src/multiuser/multiuser_wiring.js');

  // 1. Bootstrap del owner.
  const reg = userRegistry();
  console.log('=== Bootstrap ===');
  check('el registry arranca con un owner', reg.ownerId() === 'owner', `owner=${reg.ownerId()}`);

  // 2. resolveUser da de alta on-first-contact (como hace el gateway HTTP).
  console.log('\n=== resolveUser (alta on-first-contact) ===');
  const alice = resolveUser('alice', 'Alice');
  console.log(`  resolveUser('alice') -> ${alice.userId} (${alice.role})`);
  check('un usuario nuevo se da de alta como guest', alice.role === 'guest' && alice.userId === 'alice', alice.role);
  // segunda vez: ya existe, no se duplica.
  const alice2 = resolveUser('alice');
  check('segundo contacto no duplica', reg.list().filter(u => u.userId === 'alice').length === 1, 'sin duplicado');
  check('sin cabecera de usuario cae al owner', resolveUser(undefined).userId === 'owner', 'default owner');

  // 3. Aislamiento: scopedPath separa el estado por usuario.
  console.log('\n=== Aislamiento de estado ===');
  const aPath = reg.scopedPath('alice', 'memory.json');
  const oPath = reg.scopedPath('owner', 'memory.json');
  console.log(`  alice -> ${aPath}`);
  console.log(`  owner -> ${oPath}`);
  check('cada usuario tiene su scope de estado aislado', aPath !== oPath && aPath.includes('alice'), 'paths distintos');

  // 4. Permisos.
  console.log('\n=== Permisos (canActOn) ===');
  check('owner puede admin sobre cualquiera', reg.canActOn('owner', 'admin', 'alice') === true, 'owner=admin');
  check('guest NO puede escribir el scope de otro', reg.canActOn('alice', 'write', 'owner') === false, 'guest cross-write denegado');
  check('guest puede leer su propio scope', reg.canActOn('alice', 'read', 'alice') === true, 'guest self-read');

  // 5. Persistencia.
  const usersFile = join(work, 'users', 'users.json');
  check('el registry persiste users.json', existsSync(usersFile),
    existsSync(usersFile) ? `${JSON.parse(readFileSync(usersFile, 'utf-8')).users.length} usuarios` : 'no');

  process.chdir(tmpdir());
  try { rmSync(work, { recursive: true, force: true }); } catch {}
  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
