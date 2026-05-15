#!/usr/bin/env node
/**
 * Prueba funcional Sprint 3.7 — STT local con whisper.cpp.
 *
 * Verifica el flujo end-to-end del provider WhisperCpp incluso cuando
 * el binario NO está instalado (caso común en CI). Específicamente:
 *
 *   1. Diagnose reporta correctamente lo que falta.
 *   2. validateInputs rechaza con razón legible en cada caso negativo.
 *   3. transcribeWithWhisperCpp falla fail-fast cuando el binario no
 *      existe, devolviendo un error claro al operador.
 *   4. Si el operador TIENE whisper-cli + modelo, la API funciona
 *      idéntica (path: SHINOBI_WHISPERCPP_BIN + SHINOBI_WHISPERCPP_MODEL).
 *      Como CI no lo tiene, este caso se documenta como instrucción.
 */

import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  isWhisperCppAvailable,
  validateInputs,
  diagnose,
  transcribeWithWhisperCpp,
} from '../../src/stt/whisper_cpp_provider.js';

let failed = 0;
function check(cond: boolean, label: string, detail?: string): void {
  if (cond) console.log(`  ok  ${label}${detail ? ` · ${detail}` : ''}`);
  else { console.log(`  FAIL ${label}${detail ? ` · ${detail}` : ''}`); failed++; }
}

async function main(): Promise<void> {
  console.log('=== Sprint 3.7 — STT local con whisper.cpp ===');
  const work = mkdtempSync(join(tmpdir(), 'sprint3_7-'));

  try {
    // Limpiamos envs por si acaso.
    delete process.env.SHINOBI_WHISPERCPP_BIN;
    delete process.env.SHINOBI_WHISPERCPP_MODEL;

    console.log('\n--- 1. diagnose() reporta el estado ---');
    const d = await diagnose();
    console.log(`  available: ${d.available}`);
    for (const line of d.details) console.log(`    ${line}`);
    check(typeof d.available === 'boolean', 'diagnose devuelve available booleano');
    check(d.details.some(l => l.startsWith('bin:')), 'diagnose reporta bin');
    check(d.details.some(l => l.startsWith('model:')), 'diagnose reporta model');

    console.log('\n--- 2. isWhisperCppAvailable con binario inexistente ---');
    const probe = await isWhisperCppAvailable('/binario/que/no/existe/whisper-cli-fake');
    console.log(`  available=${probe.available} error=${probe.error}`);
    check(!probe.available, 'binario fake reporta NO available');
    check(!!probe.error, 'error mensaje presente');

    console.log('\n--- 3. validateInputs casos negativos ---');
    const audioPath = join(work, 'sample.mp3');
    const modelPath = join(work, 'ggml-tiny.bin');
    writeFileSync(audioPath, 'fake audio data');
    writeFileSync(modelPath, 'fake model data');

    check(!validateInputs('', {}).ok, 'audioPath vacío rechazado');
    check(!validateInputs(join(work, 'no.mp3'), { model: modelPath }).ok, 'archivo inexistente rechazado');
    const noModel = validateInputs(audioPath, {});
    check(!noModel.ok && /MODEL|modelo/.test(noModel.reason || ''), 'sin modelo configurado rechazado');
    check(validateInputs(audioPath, { model: modelPath }).ok, 'inputs válidos pasan');

    console.log('\n--- 4. transcribeWithWhisperCpp fail-fast sin binario ---');
    const r = await transcribeWithWhisperCpp(audioPath, {
      bin: '/binario/que/no/existe/whisper-cli',
      model: modelPath,
      timeoutMs: 3000,
    });
    console.log(`  ok=${r.ok}  error=${r.error}`);
    check(!r.ok, 'transcribe falla con binario inexistente');
    check(/spawn|ENOENT/i.test(r.error ?? ''), 'error indica spawn/ENOENT');
    check(typeof r.durationMs === 'number' && r.durationMs >= 0, 'durationMs reportado');

    console.log('\n--- 5. Instrucciones operador (cómo activar real) ---');
    console.log('  Para STT local real:');
    console.log('    1. Compilar whisper.cpp (https://github.com/ggerganov/whisper.cpp).');
    console.log('    2. Descargar modelo: bash ./models/download-ggml-model.sh tiny.en');
    console.log('    3. export SHINOBI_WHISPERCPP_BIN=/path/to/whisper-cli');
    console.log('    4. export SHINOBI_WHISPERCPP_MODEL=/path/to/ggml-tiny.bin');
    console.log('    5. Llamar transcribeWithWhisperCpp(audioPath) → devuelve { ok, text, durationMs }.');

    console.log('\n=== Summary ===');
    if (failed > 0) {
      console.log(`FAIL · ${failed} aserciones`);
      process.exit(1);
    }
    console.log('PASS · provider valida fail-fast, diagnose claro, error spawn legible para CI sin binario');
  } finally {
    try { if (existsSync(work)) rmSync(work, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => {
  console.error('Whisper.cpp test crashed:', e?.stack ?? e);
  process.exit(2);
});
