#!/usr/bin/env node
/**
 * FASE V6 — runner headless de Shinobi para el benchmark real.
 *
 * Ejecuta UN prompt por el orquestador de Shinobi y emite JSON a stdout:
 *   { ok, output, verdict, toolCalls, elapsedMs, error }
 *
 * Uso: npx tsx scripts/sprintV6/shinobi_oneshot.ts "<prompt>"
 * Provider: el del .env (para el benchmark se fuerza SHINOBI_PROVIDER=openrouter).
 */

import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, '../../.env'), override: true });

import { ShinobiOrchestrator } from '../../src/coordinator/orchestrator.js';
import { toolEvents } from '../../src/coordinator/tool_events.js';

async function main(): Promise<void> {
  const prompt = process.argv[2];
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
