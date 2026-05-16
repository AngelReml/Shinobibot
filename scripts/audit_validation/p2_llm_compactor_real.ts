/**
 * Validación REAL del cableado P2 de llm_compactor.
 *   1. shouldUseLLM decide segun el modo.
 *   2. compactWithLLM ejecuta una compactacion semantica REAL: resume los
 *      turnos intermedios con una llamada LLM real y devuelve el contexto
 *      reducido conservando system + ultimos turnos.
 *
 * Run: npx tsx scripts/audit_validation/p2_llm_compactor_real.ts
 */
import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env'), override: true });

import { shouldUseLLM, compactWithLLM } from '../../src/context/llm_compactor.js';
import { invokeLLM } from '../../src/providers/provider_router.js';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

async function main() {
  // Conversación con turnos intermedios VERBOSOS (output real de tools) —
  // así el resumen LLM reduce de verdad (en conversaciones cortas no lo
  // haría, y el compactor ahora lo detecta y no compacta).
  const verbose = (s: string) => s + ' '.repeat(0) + ('Detalle de la ejecución: ' +
    'se inspeccionaron los ficheros, se resolvieron las dependencias transitivas, ' +
    'se ejecutaron los comandos en el workspace, se capturó stdout y stderr, ' +
    'se verificó el exit code y se registró todo en el audit log para trazabilidad. ').repeat(4);
  const msgs = [
    { role: 'system', content: 'Eres Shinobi.' },
    { role: 'user', content: 'instala el paquete express' },
    { role: 'assistant', content: verbose('He ejecutado npm install express. Instalado v4.') },
    { role: 'user', content: 'ahora crea un servidor basico en server.js' },
    { role: 'assistant', content: verbose('Creado server.js con un endpoint GET / que responde Hello.') },
    { role: 'user', content: 'arrancalo en el puerto 8080' },
    { role: 'assistant', content: verbose('Servidor escuchando en :8080, verificado con curl.') },
    { role: 'user', content: 'añade un endpoint /health' },
    { role: 'assistant', content: 'Endpoint /health añadido, devuelve {status:ok}.' },
  ];

  // 1. shouldUseLLM.
  console.log('=== 1. shouldUseLLM por modo ===');
  check('mode=heuristic -> useLLM false', shouldUseLLM(msgs, { mode: 'heuristic' }).useLLM === false, 'heuristic');
  check('mode=llm -> useLLM true', shouldUseLLM(msgs, { mode: 'llm' }).useLLM === true, 'llm');

  // 2. compactWithLLM con llmFn REAL.
  console.log('\n=== 2. compactWithLLM — resumen semantico real ===');
  const t0 = Date.now();
  const result = await compactWithLLM(msgs, {
    mode: 'llm',
    preserveLastTurns: 2,
    llmFn: async (prompt: string) => {
      const r = await invokeLLM({ messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 400 } as any);
      if (!r.success) throw new Error(r.error || 'llm call failed');
      try { return String(JSON.parse(r.output)?.content ?? r.output); } catch { return String(r.output ?? ''); }
    },
  });
  console.log(`  method=${result.method}, compacted=${result.compacted} (${Date.now() - t0}ms)`);
  console.log(`  ${result.beforeTokens} -> ${result.afterTokens} tokens, ${result.droppedCount} mensajes resumidos`);
  const synthetic = result.messages.find((m: any) => typeof m.content === 'string' && m.content.includes('compactado-llm'));
  if (synthetic) console.log(`  resumen sintetico (extracto): ${String(synthetic.content).slice(0, 220).replace(/\n/g, ' ')}…`);

  check('compactWithLLM comprime de verdad', result.compacted === true && result.method === 'llm', `method=${result.method}`);
  check('resume los turnos intermedios (droppedCount > 0)', result.droppedCount > 0, `${result.droppedCount} resumidos`);
  check('inserta un mensaje sintetico con el resumen real', !!synthetic, 'mensaje [compactado-llm]');
  check('conserva el ultimo turno intacto',
    result.messages.some((m: any) => m.content?.includes('/health')), 'ultimos 2 turnos preservados');
  check('reduce el contexto', result.afterTokens < result.beforeTokens, `${result.beforeTokens}->${result.afterTokens}`);

  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
