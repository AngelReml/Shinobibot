/**
 * Validación REAL del cableado P2 de model_router.
 *   1. Con SHINOBI_MODEL_ROUTER=1, queries de complejidad distinta enrutan a
 *      modelos distintos con coste estimado distinto.
 *   2. Una decisión de ruta se ejecuta DE VERDAD: invokeLLM contra el
 *      provider/modelo enrutado devuelve respuesta real del LLM.
 *
 * Run: npx tsx scripts/audit_validation/p2_model_router_real.ts
 */
import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env'), override: true });
process.env.SHINOBI_MODEL_ROUTER = '1';

import { route } from '../../src/coordinator/model_router.js';
import { invokeLLM } from '../../src/providers/provider_router.js';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

async function main() {
  console.log('=== 1. Enrutado por complejidad (router ON) ===');
  const queries: Array<[string, string]> = [
    ['hola, qué tal', 'saludo'],
    ['debuggea este error de conexión y arregla el bug', 'tarea media'],
    ['audita la seguridad del repositorio buscando vulnerabilidades SQLi y RCE', 'auditoría de seguridad'],
  ];
  const decisions = queries.map(([q]) => route({ input: q }));
  for (let i = 0; i < queries.length; i++) {
    const d = decisions[i];
    console.log(`  "${queries[i][1]}" -> tier=${d.tier}, modelo=${d.choice.provider}/${d.choice.model}, ~$${d.estimatedCostUsd.toFixed(6)}`);
  }
  const models = decisions.map(d => `${d.choice.provider}/${d.choice.model}`);
  const tiers = decisions.map(d => d.tier);
  check('queries de complejidad distinta dan tiers distintos',
    new Set(tiers).size >= 2, `tiers=[${tiers.join(', ')}]`);
  check('enruta a modelos distintos', new Set(models).size >= 2, `modelos=[${models.join(', ')}]`);
  check('el coste estimado escala con la complejidad',
    decisions[2].estimatedCostUsd > decisions[0].estimatedCostUsd,
    `auditoría $${decisions[2].estimatedCostUsd.toFixed(6)} > saludo $${decisions[0].estimatedCostUsd.toFixed(6)}`);

  console.log('\n=== 2. Ejecución REAL de una decisión de ruta ===');
  // Toma la decisión de la query "saludo" (tier bajo -> provider barato) y
  // ejecuta una llamada real contra ese provider/modelo enrutado.
  const d0 = decisions[0];
  const t0 = Date.now();
  const resp = await invokeLLM(
    { messages: [{ role: 'user', content: 'Responde con una sola palabra: PONG' }], model: d0.choice.model, temperature: 0, max_tokens: 16 } as any,
    { provider: d0.choice.provider as any },
  );
  let content = '';
  try { content = JSON.parse(resp.output)?.content ?? resp.output; } catch { content = resp.output; }
  console.log(`  ruta=${d0.choice.provider}/${d0.choice.model} -> success=${resp.success} (${Date.now() - t0}ms) resp="${String(content).slice(0, 80).replace(/\n/g, ' ')}"`);
  check('la decisión de ruta se ejecuta de verdad contra el provider enrutado',
    resp.success === true, 'invokeLLM con el provider/modelo enrutado devuelve respuesta real');

  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
