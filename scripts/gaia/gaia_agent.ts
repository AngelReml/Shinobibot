#!/usr/bin/env node
/**
 * Ejecutor GAIA correcto: corre el LOOP AGÉNTICO real de shinobi
 * (runAgentLoop, caja completa de tools) con el prompt OFICIAL de GAIA como
 * SYSTEM y la pregunta como mensaje de USUARIO — separados, como manda el
 * protocolo. Esto evita el fallo de los dos ejecutores previos:
 *   - orchestrator one-shot metía el system-prompt en el turno de usuario →
 *     glm respondía un PLAN sin tool calls y terminaba.
 *   - run_one (ShinobiAdapter) usaba su propio system → glm pedía "ask me the
 *     question".
 *
 * Entrada: --prompt-file <path> con la PREGUNTA SOLA (sin el system prompt).
 * Salida (stdout, JSON): { ok, output, verdict, toolCalls, iterations, error }.
 *
 * Uso: npx tsx scripts/gaia/gaia_agent.ts --prompt-file q.txt
 */
import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import { readFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, '../../.env'), override: false });

import '../../src/tools/index.js';
import { runAgentLoop } from '../../src/agents/agent_loop.js';
import { runInContext } from '../../src/agents/exec_context.js';
import { getAllTools } from '../../src/tools/index.js';
import { GAIA_SYSTEM_PROMPT } from '../../src/gaia/gaia_matcher.js';

async function main(): Promise<void> {
  // Routing fijo (post-import gana a dotenv override:true): OpenRouter/glm,
  // sin failover cross-provider ni model_router.
  if (process.env.SHINOBI_BENCH === '1') {
    process.env.SHINOBI_PROVIDER = 'openrouter';
    process.env.SHINOBI_FAILOVER_CHAIN = 'openrouter';
    process.env.SHINOBI_MODEL_ROUTER = '0';
    process.env.SHINOBI_MODEL_DEFAULT = process.env.GAIA_MODEL || 'z-ai/glm-4.7-flash';
    // Búsqueda vía DuckDuckGo HTML: funciona en el Chrome headless (Bing sirve
    // página anti-bot degradada al headless).
    process.env.SHINOBI_SEARCH_ENGINE = process.env.SHINOBI_SEARCH_ENGINE || 'ddg';
    // Navegación rápida: networkidle consume 45s/página (ads) → timeout de tarea.
    process.env.SHINOBI_NAV_WAIT = process.env.SHINOBI_NAV_WAIT || 'domcontentloaded';
    process.env.SHINOBI_NAV_TIMEOUT_MS = process.env.SHINOBI_NAV_TIMEOUT_MS || '20000';
    process.env.SHINOBI_NAV_SETTLE_MS = process.env.SHINOBI_NAV_SETTLE_MS || '1200';
  }
  const maxIterations = Number(process.env.SHINOBI_MAX_ITERATIONS) || 20;

  // Deadline interno: el proceso SALE LIMPIO por sí mismo antes de que el runner
  // tenga que matarlo (matar el árbol en Windows deja huérfanos). Emite un
  // resultado de timeout y termina con código 0 → el runner lo lee, no lo mata.
  const taskDeadlineMs = Number(process.env.SHINOBI_TASK_DEADLINE_MS) || 0;
  if (taskDeadlineMs > 0) {
    setTimeout(() => {
      console.log(JSON.stringify({ ok: false, output: '', verdict: 'WALL_CLOCK', toolCalls: [], iterations: 0, error: 'task wall-clock exceeded' }));
      process.exit(0);
    }, taskDeadlineMs).unref();
  }

  const fileIdx = process.argv.indexOf('--prompt-file');
  let question: string | undefined;
  if (fileIdx >= 0 && process.argv[fileIdx + 1]) question = readFileSync(process.argv[fileIdx + 1], 'utf-8');
  else question = process.argv[2];
  if (!question || !question.trim()) {
    console.log(JSON.stringify({ ok: false, error: 'sin pregunta' }));
    process.exit(1);
  }

  const workdir = mkdtempSync(join(tmpdir(), 'gaia-agent-'));
  const tools = getAllTools().map((t) => t.name);

  let result: any; let error: string | undefined;
  try {
    result = await runInContext(
      { cwd: workdir, workspaceRoot: workdir },
      () => runAgentLoop({
        task: question!.trim(),
        systemPrompt: GAIA_SYSTEM_PROMPT,
        tools,
        label: 'gaia',
        maxIterations,
        temperature: Number(process.env.SHINOBI_TEMPERATURE ?? '0'), // temp baja: determinismo
      }),
    );
  } catch (e: any) {
    error = e?.message ?? String(e);
  }

  console.log(JSON.stringify({
    ok: !!result?.ok,
    output: String(result?.output ?? '').trim(),
    verdict: result?.verdict ?? (error ? 'ERROR' : 'UNKNOWN'),
    toolCalls: result?.toolsUsed ?? [],
    iterations: result?.iterations ?? 0,
    error: error ?? result?.error,
  }));
  process.exit(0);
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e?.message ?? String(e) }));
  process.exit(1);
});
