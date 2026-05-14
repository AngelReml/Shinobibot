#!/usr/bin/env node
/**
 * Prueba funcional Sprint 2.1 — Loop detector v3 (capa semántica de
 * progreso vs objetivo declarado).
 *
 * Demuestra cuatro escenarios sintéticos con MockProgressJudge:
 *
 *   1. Tarea que progresa monotónicamente (0.1→0.3→0.6→0.9) — el
 *      tracker NO aborta.
 *   2. Tarea que progresa LENTO pero positivo (≥minDelta) — NO aborta.
 *   3. Tarea estancada por debajo del doneThreshold (0.3→0.3→0.3) — aborta
 *      con NO_SEMANTIC_PROGRESS en la 3ª iteración.
 *   4. Tarea que regresa al inicio (0.5→0.4→0.3) — aborta.
 *
 * La capa real usaría LLMProgressJudge con groq llama-3.3, pero esta
 * prueba usa MockProgressJudge para ser hermética (sin red, sin tokens).
 */

import { ProgressTracker, MockProgressJudge } from '../../src/coordinator/progress_judge.js';

let failed = 0;
function check(cond: boolean, label: string, detail?: string): void {
  if (cond) console.log(`  ok  ${label}${detail ? ` · ${detail}` : ''}`);
  else { console.log(`  FAIL ${label}${detail ? ` · ${detail}` : ''}`); failed++; }
}

async function scenario(name: string, scores: number[], opts: { expectAbort: boolean; abortIter?: number }) {
  console.log(`\n--- Scenario: ${name} ---`);
  const t = new ProgressTracker({ judge: new MockProgressJudge(scores) });
  let abortedAt = -1;
  for (let i = 0; i < scores.length; i++) {
    const r = await t.recordIteration('demo goal', `iteration #${i + 1}`);
    console.log(`  iter ${i + 1}: score=${r.latestScore.toFixed(2)}${r.abort ? ` ⇒ ABORT (${r.verdict})` : ''}`);
    if (r.abort && abortedAt < 0) abortedAt = i + 1;
  }
  if (opts.expectAbort) {
    check(abortedAt > 0, `aborta como se esperaba`);
    if (opts.abortIter !== undefined) {
      check(abortedAt === opts.abortIter, `aborta en la iter ${opts.abortIter}`, `(real: ${abortedAt})`);
    }
  } else {
    check(abortedAt < 0, `NO aborta como se esperaba`);
  }
}

async function main(): Promise<void> {
  console.log('=== Sprint 2.1 — Progress judge (loop detector v3) ===');

  await scenario('Progreso monotónico [0.1, 0.3, 0.6, 0.9]', [0.1, 0.3, 0.6, 0.9], { expectAbort: false });
  await scenario('Progreso lento positivo [0.3, 0.35, 0.4]', [0.3, 0.35, 0.4], { expectAbort: false });
  await scenario('Estancado bajo done [0.3, 0.3, 0.3]', [0.3, 0.3, 0.3], { expectAbort: true, abortIter: 3 });
  await scenario('Regresión [0.5, 0.4, 0.3]', [0.5, 0.4, 0.3], { expectAbort: true, abortIter: 3 });
  await scenario('Done plateau [0.9, 0.9, 0.9]', [0.9, 0.9, 0.9], { expectAbort: false });
  await scenario('Pico y caída [0.4, 0.6, 0.55, 0.5]', [0.4, 0.6, 0.55, 0.5], { expectAbort: true });

  // Bonus: configuración personalizada.
  console.log('\n--- Scenario: ventana 5 + minDelta 0.10 ---');
  const t = new ProgressTracker({
    judge: new MockProgressJudge([0.30, 0.35, 0.40, 0.42, 0.44]),
    windowSize: 5,
    minDelta: 0.10,
  });
  let aborted = -1;
  for (let i = 0; i < 5; i++) {
    const r = await t.recordIteration('g', `iter ${i + 1}`);
    if (r.abort && aborted < 0) aborted = i + 1;
  }
  // delta = 0.14 ≥ 0.10 → NO aborta.
  check(aborted < 0, 'minDelta 0.10 permite progreso lento si supera el threshold');

  console.log('\n=== Summary ===');
  if (failed > 0) {
    console.log(`FAIL · ${failed} aserciones`);
    process.exit(1);
  }
  console.log('PASS · loop detector v3 distingue progreso real de estancamiento');
}

main().catch((e) => {
  console.error('Progress test crashed:', e?.stack ?? e);
  process.exit(2);
});
