/**
 * Validación REAL del cableado P2 de progress_judge (capa 3 semántica).
 *   1. ProgressTracker real: ventana de scores estancada -> aborta
 *      NO_SEMANTIC_PROGRESS; ventana que progresa -> no aborta.
 *   2. LLMProgressJudge real: puntúa un output contra un objetivo con una
 *      llamada LLM real.
 *
 * Run: npx tsx scripts/audit_validation/p2_progress_judge_real.ts
 */
import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env'), override: true });

import { ProgressTracker, LLMProgressJudge } from '../../src/coordinator/progress_judge.js';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

async function main() {
  // 1. Lógica real del tracker (recordScore ejercita el evaluate() real).
  console.log('=== 1. ProgressTracker — ventana estancada ===');
  const stalled = new ProgressTracker();
  stalled.recordScore(0.30, 'iter1');
  stalled.recordScore(0.31, 'iter2');
  const r3 = stalled.recordScore(0.32, 'iter3');
  console.log(`  scores 0.30 → 0.31 → 0.32 -> abort=${r3.abort}, verdict=${r3.verdict ?? '-'}`);
  check('aborta NO_SEMANTIC_PROGRESS si la ventana no progresa',
    r3.abort === true && r3.verdict === 'NO_SEMANTIC_PROGRESS', r3.reason ?? '');

  console.log('\n=== 2. ProgressTracker — ventana que progresa ===');
  const moving = new ProgressTracker();
  moving.recordScore(0.20, 'a');
  moving.recordScore(0.50, 'b');
  const m3 = moving.recordScore(0.80, 'c');
  console.log(`  scores 0.20 → 0.50 → 0.80 -> abort=${m3.abort}`);
  check('NO aborta si hay progreso real', m3.abort === false, `delta sano`);

  console.log('\n=== 3. ProgressTracker — casi hecho (doneThreshold) ===');
  const done = new ProgressTracker();
  done.recordScore(0.84, 'a'); done.recordScore(0.85, 'b');
  const d3 = done.recordScore(0.86, 'c');
  check('NO aborta si ya está casi hecho (score ≥ 0.85)', d3.abort === false, `last=0.86`);

  // 4. LLMProgressJudge REAL — una llamada LLM real.
  console.log('\n=== 4. LLMProgressJudge — score real contra un LLM ===');
  const judge = new LLMProgressJudge();
  console.log(`  judge: ${judge.id}`);
  const t0 = Date.now();
  const score = await judge.score(
    'Escribir una función que sume dos números y devuelva el resultado.',
    'He creado la función `function sum(a,b){ return a+b; }` y la he probado: sum(2,3) devuelve 5. Tarea completada.',
  );
  console.log(`  score real = ${score} (${Date.now() - t0}ms)`);
  check('el juez LLM devuelve un score 0..1', Number.isFinite(score) && score >= 0 && score <= 1, `score=${score}`);
  check('puntúa alto un output que cumple el objetivo', score >= 0.6, `output que completa la tarea -> ${score}`);

  console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
