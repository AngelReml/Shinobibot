#!/usr/bin/env node
/**
 * Prueba funcional Sprint P2.1 — Context compactor LLM-based opcional.
 *
 * Demuestra:
 *   1. Modo heuristic NUNCA invoca LLM (cero coste).
 *   2. Modo llm SIEMPRE invoca con un llmFn mock.
 *   3. Modo auto invoca solo cuando tokens > budget*threshold.
 *   4. Cuando llmFn throw, retorna `skipped` sin romper.
 *   5. El summary mantiene system msg + últimos N turnos.
 */

import { resolveMode, shouldUseLLM, compactWithLLM } from '../../src/context/llm_compactor.js';

let failed = 0;
function check(cond: boolean, label: string): void {
  if (cond) console.log(`  ok  ${label}`);
  else { console.log(`  FAIL ${label}`); failed++; }
}

const SHORT = [
  { role: 'user', content: 'hola' },
  { role: 'assistant', content: 'hi' },
];

const LONG_CONVO = (() => {
  const out: any[] = [{ role: 'system', content: 'Eres Shinobi.' }];
  for (let i = 0; i < 12; i++) {
    out.push({ role: 'user', content: `pregunta ${i + 1} sobre tema ${(i % 3) + 1}` });
    out.push({ role: 'assistant', content: `respuesta detallada ${i + 1} con tools ejecutadas` });
  }
  return out;
})();

async function main(): Promise<void> {
  console.log('=== Sprint P2.1 — Context compactor LLM-based opcional ===');

  // ── 1. resolveMode ──
  console.log('\n--- 1. resolveMode ---');
  check(resolveMode() === 'heuristic', 'default heuristic');
  process.env.SHINOBI_COMPACTOR_MODE = 'llm';
  check(resolveMode(process.env.SHINOBI_COMPACTOR_MODE) === 'llm', 'env llm respetada');
  process.env.SHINOBI_COMPACTOR_MODE = 'auto';
  check(resolveMode(process.env.SHINOBI_COMPACTOR_MODE) === 'auto', 'env auto respetada');
  delete process.env.SHINOBI_COMPACTOR_MODE;

  // ── 2. Patrón: caller pregunta a shouldUseLLM antes de llamar a compactWithLLM ──
  console.log('\n--- 2. modo heuristic: shouldUseLLM dice false ---');
  let llmInvocations = 0;
  const llmFn = async (_p: string) => { llmInvocations++; return 'mock summary'; };
  const decideH = shouldUseLLM(LONG_CONVO, { mode: 'heuristic' });
  check(decideH.useLLM === false, 'shouldUseLLM heuristic → useLLM=false (caller hace fallback al heurístico)');
  if (decideH.useLLM) await compactWithLLM(LONG_CONVO, { llmFn });
  check(llmInvocations === 0, 'patrón shouldUseLLM-first: cero invocaciones LLM en modo heuristic');

  // ── 3. modo llm SIEMPRE ──
  console.log('\n--- 3. modo llm SIEMPRE ---');
  llmInvocations = 0;
  const rL = await compactWithLLM(LONG_CONVO, {
    mode: 'llm', preserveLastTurns: 2, llmFn,
  });
  check(llmInvocations === 1, 'llmFn invocado 1 vez');
  check(rL.compacted === true, 'compactado=true');
  check(rL.method === 'llm', 'method=llm');
  check(rL.afterTokens < rL.beforeTokens, `tokens redujeron: ${rL.beforeTokens} → ${rL.afterTokens}`);

  // Verifica que se preservó system + últimos 2 turnos.
  const hasSystem = rL.messages.some(m => m.role === 'system' && m.content === 'Eres Shinobi.');
  check(hasSystem, 'system msg preservado');
  const lastTwoUser = rL.messages.filter(m => m.role === 'user').slice(-2);
  check(lastTwoUser[0]?.content === 'pregunta 11 sobre tema 2', 'turno -2 preservado');
  check(lastTwoUser[1]?.content === 'pregunta 12 sobre tema 3', 'turno -1 preservado');

  // Synthetic con summary.
  const synth = rL.messages.find(m => typeof m.content === 'string' && m.content.includes('compactado-llm'));
  check(synth?.content.includes('mock summary'), 'synthetic incluye summary');

  // ── 4. modo auto: corto skip, largo compacta ──
  console.log('\n--- 4. modo auto ---');
  llmInvocations = 0;
  const rA1 = shouldUseLLM(SHORT, { mode: 'auto', budgetTokens: 32000, autoThreshold: 0.5 });
  check(rA1.useLLM === false, 'auto + corto → no LLM');

  const rA2 = shouldUseLLM(LONG_CONVO, { mode: 'auto', budgetTokens: 100, autoThreshold: 0.5 });
  check(rA2.useLLM === true, `auto + budget bajo + ${rA2.estTokens} tokens → LLM`);

  // ── 5. llmFn throw → skipped, no rompe ──
  console.log('\n--- 5. llmFn throw → graceful fallback ---');
  const rErr = await compactWithLLM(LONG_CONVO, {
    mode: 'llm',
    llmFn: async () => { throw new Error('429 rate limit'); },
  });
  check(rErr.method === 'skipped', 'method=skipped');
  check(rErr.compacted === false, 'no compactado');
  check(rErr.error?.includes('429') === true, 'error propagado');
  // Messages devuelve los originales (callable debe hacer fallback).
  check(rErr.messages === LONG_CONVO, 'messages original devueltos');

  // ── Resumen ──
  console.log('\n=== Summary ===');
  if (failed > 0) { console.log(`FAIL · ${failed} aserciones`); process.exit(1); }
  console.log('PASS · LLM compactor opcional integrado con heuristic + auto + fallback');
}

main().catch((e) => {
  console.error('Sprint P2.1 funcional crashed:', e?.stack ?? e);
  process.exit(2);
});
