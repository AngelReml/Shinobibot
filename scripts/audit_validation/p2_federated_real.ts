/**
 * Validación REAL del fix C10 + cadena federada de skills.
 * Ejercita FederatedSkillRegistry.fetch() con fuentes reales (en memoria):
 *   - una fuente honesta cuyo body coincide con declaredHash -> se acepta.
 *   - una fuente comprometida cuyo body NO coincide -> se RECHAZA (C10) y
 *     se cae a la siguiente fuente.
 *
 * Run: npx tsx scripts/audit_validation/p2_federated_real.ts
 */
import { createHash } from 'crypto';
import { FederatedSkillRegistry } from '../../src/skills/sources/federated_registry.js';
import { federatedSkillRegistry } from '../../src/skills/sources/federated_wiring.js';
import type { SkillSource, SkillBundle, RemoteSkillMeta } from '../../src/skills/sources/types.js';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

function sha256(s: string): string { return createHash('sha256').update(s).digest('hex'); }

/** Fuente en memoria con un body y un declaredHash configurables. */
function memSource(id: string, priority: number, body: string, declaredHash: string): SkillSource {
  return {
    id, priority,
    isConfigured: () => true,
    async search(): Promise<RemoteSkillMeta[]> { return []; },
    async fetch(): Promise<SkillBundle> {
      return { manifest: { name: 'demo', version: '1.0.0' }, body, declaredHash };
    },
  };
}

async function main() {
  const body = '---\nname: demo\n---\nCuerpo legítimo de la skill.';
  const goodHash = sha256(body);

  // 1. Fuente honesta: body coincide con declaredHash -> aceptada.
  console.log('=== 1. Fuente honesta (hash correcto) ===');
  const honest = new FederatedSkillRegistry({ sources: [memSource('honesta', 0, body, goodHash)] });
  const b1 = await honest.fetch('demo');
  console.log(`  fetch -> source=${b1.source}, body len=${b1.body.length}`);
  check('un bundle con hash correcto se acepta', b1.source === 'honesta' && b1.body === body, 'aceptado');

  // 2. Fuente comprometida: declaredHash dice X pero el body es otro.
  console.log('\n=== 2. Fuente comprometida (hash NO coincide) ===');
  const tampered = memSource('comprometida', 0, 'CUERPO MANIPULADO POR UN ATACANTE', goodHash);
  const compromisedOnly = new FederatedSkillRegistry({ sources: [tampered] });
  let rejected = false;
  try { await compromisedOnly.fetch('demo'); }
  catch (e: any) { rejected = /hash mismatch/i.test(e?.message ?? ''); console.log(`  rechazado: ${e?.message}`); }
  check('un bundle con el body manipulado se RECHAZA (C10)', rejected, 'hash mismatch detectado');

  // 3. Fallback: fuente comprometida (prio 0) + honesta (prio 1) -> usa la honesta.
  console.log('\n=== 3. Comprometida -> fallback a la honesta ===');
  const mixed = new FederatedSkillRegistry({
    sources: [tampered, memSource('honesta', 1, body, goodHash)],
  });
  const b3 = await mixed.fetch('demo');
  console.log(`  fetch -> source=${b3.source}`);
  check('cae a la fuente honesta cuando la primera está manipulada', b3.source === 'honesta', `source=${b3.source}`);

  // 4. El factory de producción ensambla el registry.
  console.log('\n=== 4. Factory de producción ===');
  const reg = federatedSkillRegistry();
  const active = reg.active();
  console.log(`  fuentes: ${active.map((a) => `${a.id}(prio ${a.priority}, cfg=${a.configured})`).join(', ')}`);
  check('federatedSkillRegistry ensambla la cadena', active.length >= 2, `${active.length} fuentes`);

  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
