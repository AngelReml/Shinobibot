#!/usr/bin/env node
/**
 * Runner headless de Shinobi para la cata GAIA (puente Shinobi↔tarea).
 *
 * Ejecuta UN prompt por el orquestador de Shinobi y emite JSON a stdout:
 *   { ok, output, verdict, toolCalls, elapsedMs, error }
 *
 * Uso: npx tsx scripts/gaia/shinobi_oneshot.ts "<prompt>"
 * Provider: el del entorno. La cata fuerza SHINOBI_PROVIDER=openrouter +
 * SHINOBI_MODEL_DEFAULT=z-ai/glm-4.7-flash + OPENROUTER_API_KEY.
 *
 * Idéntico en espíritu al archive/scripts/sprintV6/shinobi_oneshot.ts que ya
 * resolvió GAIA en la cata previa; sólo cambia de ubicación.
 */
import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, '../../.env'), override: false });

import { ShinobiOrchestrator } from '../../src/coordinator/orchestrator.js';
import { toolEvents } from '../../src/coordinator/tool_events.js';

async function main(): Promise<void> {
  // Benchmark JUSTO y reproducible: fijamos el routing AQUÍ (dentro de main,
  // tras todos los imports) para ganar a cualquier dotenv `override:true` que
  // se ejecute en tiempo de import y pise el env del proceso padre. Un solo
  // provider (OpenRouter) + un solo modelo, sin failover cross-provider (que
  // rotaba a otros providers con el model ID de OpenRouter → "invalid model ID").
  if (process.env.SHINOBI_BENCH === '1') {
    process.env.SHINOBI_PROVIDER = 'openrouter';
    process.env.SHINOBI_FAILOVER_CHAIN = 'openrouter';
    process.env.SHINOBI_MODEL_ROUTER = '0';
    process.env.SHINOBI_MODEL_DEFAULT = process.env.GAIA_MODEL || 'z-ai/glm-4.7-flash';
    if (!process.env.SHINOBI_MAX_ITERATIONS) process.env.SHINOBI_MAX_ITERATIONS = '20';
    // Modo LOCAL: provider directo sin gateway intermediario
    // empuja al agente a delegar research vía start_kernel_mission → se queda en
    // un PLAN sin ejecutar (0 tool calls). LOCAL quita esa tool y obliga a usar
    // las herramientas locales (browser/web) para resolver la tarea de verdad.
    // mode is always local (setMode removed)
  }

  // Prompt por --prompt-file <path> (evita quoting en shell) o argv[2].
  const fileIdx = process.argv.indexOf('--prompt-file');
  let prompt: string | undefined;
  if (fileIdx >= 0 && process.argv[fileIdx + 1]) {
    prompt = readFileSync(process.argv[fileIdx + 1], 'utf-8');
  } else {
    prompt = process.argv[2];
  }
  if (!prompt) {
    console.log(JSON.stringify({ ok: false, error: 'sin prompt' }));
    process.exit(1);
  }

  const toolCalls: string[] = [];
  try {
    toolEvents().on('tool_started', (e: any) => {
      if (e?.tool) toolCalls.push(String(e.tool));
    });
  } catch { /* tool_events opcional */ }

  const t0 = Date.now();
  let result: any;
  let error: string | undefined;
  try {
    result = await ShinobiOrchestrator.process(prompt);
  } catch (e: any) {
    error = e?.message ?? String(e);
  }
  const elapsedMs = Date.now() - t0;

  const verdict = result?.verdict ?? (error ? 'ERROR' : 'UNKNOWN');
  const output = String(result?.response ?? result?.output ?? '').trim();
  console.log(JSON.stringify({
    ok: verdict === 'VALID_AGENT',
    output,
    verdict,
    toolCalls,
    elapsedMs,
    error: error ?? result?.error,
  }));
  process.exit(0);
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e?.message ?? String(e) }));
  process.exit(1);
});
