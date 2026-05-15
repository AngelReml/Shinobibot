#!/usr/bin/env node
/**
 * FASE V3 — validación whisper.cpp local vs Whisper API.
 *
 * Transcribe el mismo audio con ambos backends y compara tiempo +
 * texto. El audio es `samples/jfk.wav` de whisper.cpp (excerpt real
 * del discurso de JFK, ~11 s).
 *
 * Env esperadas:
 *   SHINOBI_WHISPERCPP_BIN    binario whisper-cli (o wrapper)
 *   SHINOBI_WHISPERCPP_MODEL  modelo ggml .bin
 *   OPENAI_API_KEY            (opcional) para el backend API
 *   V3_AUDIO                  path al audio de prueba
 */

import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// override:true → el .env gana sobre placeholders que pueda haber en el
// shell (p.ej. un OPENAI_API_KEY=tu_api_key... heredado del perfil).
dotenvConfig({ path: resolve(__dirname, '../../.env'), override: true });

import { transcribeWithWhisperCpp, isWhisperCppAvailable } from '../../src/stt/whisper_cpp_provider.js';

interface BackendResult {
  backend: string;
  ok: boolean;
  text: string;
  elapsedMs: number;
  error?: string;
}

async function transcribeLocal(audio: string): Promise<BackendResult> {
  const avail = await isWhisperCppAvailable();
  if (!avail.available) {
    return { backend: 'whisper.cpp local', ok: false, text: '', elapsedMs: 0, error: avail.error };
  }
  const t0 = Date.now();
  const r = await transcribeWithWhisperCpp(audio, { language: 'en' });
  return {
    backend: 'whisper.cpp local',
    ok: r.ok,
    text: r.text,
    elapsedMs: Date.now() - t0,
    error: r.error,
  };
}

async function transcribeApi(audio: string): Promise<BackendResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return { backend: 'Whisper API', ok: false, text: '', elapsedMs: 0, error: 'OPENAI_API_KEY ausente' };
  }
  const { readFileSync } = await import('fs');
  const { basename } = await import('path');
  const axios = (await import('axios')).default;
  const t0 = Date.now();
  try {
    const buffer = readFileSync(audio);
    const blob = new Blob([new Uint8Array(buffer)]);
    const form = new FormData();
    form.append('file', blob, basename(audio));
    form.append('model', 'whisper-1');
    form.append('language', 'en');
    const resp = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: { Authorization: `Bearer ${key}` },
      timeout: 120_000,
    });
    return {
      backend: 'Whisper API',
      ok: true,
      text: (resp.data?.text ?? '').toString().trim(),
      elapsedMs: Date.now() - t0,
    };
  } catch (e: any) {
    return {
      backend: 'Whisper API',
      ok: false, text: '', elapsedMs: Date.now() - t0,
      error: e?.response?.data?.error?.message ?? e?.message ?? String(e),
    };
  }
}

/** Similaridad word-level (Jaccard) para comparar calidad. */
function wordSimilarity(a: string, b: string): number {
  const norm = (s: string) => new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean)
  );
  const sa = norm(a), sb = norm(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}

async function main(): Promise<void> {
  console.log('=== FASE V3 — whisper.cpp local vs Whisper API ===');
  const audio = process.env.V3_AUDIO || resolve(__dirname, '../../.run-jfk.wav');
  if (!existsSync(audio)) {
    console.error(`FALLO: audio no encontrado: ${audio}. Define V3_AUDIO.`);
    process.exit(1);
  }
  console.log(`Audio: ${audio}`);
  console.log(`whisper.cpp bin: ${process.env.SHINOBI_WHISPERCPP_BIN ?? '(no set)'}`);
  console.log(`whisper.cpp model: ${process.env.SHINOBI_WHISPERCPP_MODEL ?? '(no set)'}`);

  console.log('\n--- Backend 1: whisper.cpp local ---');
  const local = await transcribeLocal(audio);
  if (local.ok) {
    console.log(`  tiempo: ${local.elapsedMs} ms`);
    console.log(`  texto:  "${local.text}"`);
  } else {
    console.log(`  FALLO: ${local.error}`);
  }

  console.log('\n--- Backend 2: Whisper API ---');
  const api = await transcribeApi(audio);
  if (api.ok) {
    console.log(`  tiempo: ${api.elapsedMs} ms`);
    console.log(`  texto:  "${api.text}"`);
  } else {
    console.log(`  no disponible: ${api.error}`);
  }

  console.log('\n=== COMPARATIVA ===');
  if (local.ok && api.ok) {
    const sim = wordSimilarity(local.text, api.text);
    console.log(`  similaridad texto (Jaccard word-level): ${(sim * 100).toFixed(1)}%`);
    console.log(`  local: ${local.elapsedMs} ms · API: ${api.elapsedMs} ms`);
    const faster = local.elapsedMs < api.elapsedMs ? 'local' : 'API';
    console.log(`  más rápido: ${faster}`);
  } else if (local.ok) {
    console.log('  Solo whisper.cpp local disponible — comparativa parcial.');
  }

  // Aserciones.
  let failed = 0;
  const check = (c: boolean, l: string): void => {
    if (c) console.log(`  ok  ${l}`);
    else { console.log(`  FAIL ${l}`); failed++; }
  };
  console.log('\n=== ASERCIONES ===');
  check(local.ok, 'whisper.cpp local transcribió');
  check(/country/i.test(local.text) && /fellow/i.test(local.text),
    'texto local contiene palabras clave del discurso JFK');
  if (api.ok) {
    const sim = wordSimilarity(local.text, api.text);
    check(sim >= 0.7, `local vs API similaridad ≥ 70% (${(sim * 100).toFixed(1)}%)`);
  }

  if (failed > 0) {
    console.log(`\nV3 FALLIDA · ${failed} aserciones`);
    process.exit(1);
  }
  console.log('\nV3 OK · whisper.cpp local funcional con fallback a Whisper API');
}

main().catch((e) => {
  console.error('V3 crashed:', e?.stack ?? e);
  process.exit(2);
});
