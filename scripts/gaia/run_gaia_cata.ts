#!/usr/bin/env node
/**
 * Cata GAIA con Shinobi — mide señal (aciertos vs ground truth) + coste REAL
 * antes de escalar. Reutiliza el scorer OFICIAL validado (src/gaia) y el
 * orquestador de Shinobi como ejecutor (scripts/gaia/shinobi_oneshot.ts).
 *
 * - Dataset: GAIA validation local (metadata.jsonl generado desde el parquet
 *   de HF; lo descarga el operador con su token HF). Ruta por --metadata o
 *   GAIA_METADATA. NO se incluye en el repo (dataset gated).
 * - Scorer: src/gaia/gaia_matcher.ts (port 1:1 del question_scorer oficial,
 *   con tests de paridad). NO se reinventa la normalización.
 * - System prompt: el oficial del paper (GAIA_SYSTEM_PROMPT), idéntico.
 * - Coste REAL: delta de OpenRouter /auth/key antes/después de cada tarea
 *   (cero cambios en el agente). Tokens in/out: aproximados (el agente no los
 *   expone) y claramente etiquetados como tales.
 *
 * Flags:
 *   --metadata FILE   ruta a metadata.jsonl (o env GAIA_METADATA)
 *   --levels 1,2      niveles a incluir (default 1,2)
 *   --limit N         máx tareas tras filtrar (default 17)
 *   --runs N          runs por tarea (default 1)
 *   --with-attachments incluir tareas con ficheros adjuntos (default: NO)
 *   --out FILE        jsonl de resultados (append). Default scripts/gaia/results-<ts>.jsonl
 *   --budget USD      aborta si el coste real acumulado supera este techo (default 5)
 *   --dry-run         NO llama al agente ni a la API: imprime selección + estimación y sale
 *
 * NO lanza nada que llame a la API salvo que se omita --dry-run. El punto de
 * control de coste es responsabilidad del operador.
 */
import { config as dotenvConfig } from 'dotenv';
import { execFile, spawn } from 'child_process';
import { appendFileSync, readFileSync, existsSync, writeFileSync, rmSync, mkdtempSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { gaiaScorer, extractFinalAnswer, GAIA_SYSTEM_PROMPT } from '../../src/gaia/gaia_matcher.js';
import { launchHeadlessChrome, killTree, type HeadlessChrome } from './headless_chrome.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Carga OPENROUTER_API_KEY / SHINOBI_* del .env para el proceso padre (delta de coste).
dotenvConfig({ path: resolve(__dirname, '../../.env'), override: false });
const SHINOBI_HOME = resolve(__dirname, '../..');
const DEFAULT_MODEL = 'z-ai/glm-4.7-flash';
let MODEL = DEFAULT_MODEL; // resuelto desde --model en parseArgs

// Ciclo de vida: PIDs de subprocesos gaia_agent vivos, para matar su árbol al
// terminar/interrumpir y no dejar huérfanos (clave en Windows).
const liveAgentPids = new Set<number>();
let headlessChrome: HeadlessChrome | null = null;
let watchdogPid: number | undefined;
let cleanedUp = false;

/** Idempotente: mata el watchdog + el Chrome headless dedicado + los gaia_agent. */
function cleanup(): void {
  if (cleanedUp) return;
  cleanedUp = true;
  if (watchdogPid) { killTree(watchdogPid); watchdogPid = undefined; }
  for (const pid of liveAgentPids) killTree(pid);
  liveAgentPids.clear();
  if (headlessChrome) { headlessChrome.kill(); headlessChrome = null; }
}
// Ejecutor: runAgentLoop con GAIA_SYSTEM_PROMPT como system y la pregunta como
// user (separados). El oneshot del orchestrator metía todo en el turno de
// usuario → glm planificaba sin ejecutar.
const ONESHOT = resolve(__dirname, 'gaia_agent.ts');

// Precios OpenRouter (verificados): in $0.060/1M, out $0.400/1M.
const PRICE_IN_PER_TOK = 0.060 / 1_000_000;
const PRICE_OUT_PER_TOK = 0.400 / 1_000_000;

interface GaiaTask {
  task_id: string;
  Question: string;
  Level: string | number;
  'Final answer': string;
  file_name: string;
}

interface Cell {
  taskId: string;
  level: string;
  run: number;
  expected: string;
  rawAnswer: string;
  rawOutput: string;
  match: boolean;
  status: 'OK' | 'INFRA_FAIL';
  elapsedMs: number;
  steps: number;
  approxTokensIn: number;
  approxTokensOut: number;
  costUsdReal: number | null;   // delta OpenRouter (real); null si no se pudo medir
  tools?: string[];             // tools que invocó (prueba de delegación)
  error?: string;
}

interface Args {
  metadata: string; levels: string[]; limit: number; runs: number;
  withAttachments: boolean; out: string; budget: number; dryRun: boolean; model: string; timeoutSec: number;
}
let perTaskTimeoutMs = 360000;

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const out: Args = {
    metadata: process.env.GAIA_METADATA ?? '',
    levels: ['1', '2'], limit: 17, runs: 1, withAttachments: false,
    out: resolve(__dirname, `results-${Date.now()}.jsonl`), budget: 5, dryRun: false,
    model: process.env.GAIA_MODEL || DEFAULT_MODEL, timeoutSec: 360,
  };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--metadata') out.metadata = a[++i];
    else if (a[i] === '--levels') out.levels = a[++i].split(',').map((s) => s.trim());
    else if (a[i] === '--limit') out.limit = parseInt(a[++i], 10);
    else if (a[i] === '--runs') out.runs = parseInt(a[++i], 10);
    else if (a[i] === '--with-attachments') out.withAttachments = true;
    else if (a[i] === '--out') out.out = resolve(a[++i]);
    else if (a[i] === '--budget') out.budget = parseFloat(a[++i]);
    else if (a[i] === '--dry-run') out.dryRun = true;
    else if (a[i] === '--model') out.model = a[++i];
    else if (a[i] === '--timeout') out.timeoutSec = parseInt(a[++i], 10);
  }
  MODEL = out.model;
  perTaskTimeoutMs = out.timeoutSec * 1000;
  return out;
}

function loadTasks(args: Args): GaiaTask[] {
  if (!args.metadata) throw new Error('falta --metadata (o env GAIA_METADATA): ruta al metadata.jsonl de GAIA validation');
  if (!existsSync(args.metadata)) throw new Error(`metadata no encontrado: ${args.metadata}`);
  let rows = readFileSync(args.metadata, 'utf-8').split('\n').filter(Boolean)
    .map((l) => JSON.parse(l) as GaiaTask);
  if (args.levels.length > 0) rows = rows.filter((r) => args.levels.includes(String(r.Level)));
  if (!args.withAttachments) rows = rows.filter((r) => !r.file_name || String(r.file_name).trim() === '');
  return rows.slice(0, args.limit);
}

function approxTok(s: string): number { return Math.ceil((s || '').length / 4); }

const IS_WIN = process.platform === 'win32';

function run(cmd: string, cmdArgs: string[], timeoutMs: number, env: NodeJS.ProcessEnv):
Promise<{ stdout: string; stderr: string; timedOut: boolean; spawnError?: string }> {
  return new Promise((resolveP) => {
    let timedOut = false;
    // En Windows npx es npx.cmd → execFile necesita shell para resolverlo.
    const child = execFile(cmd, cmdArgs, { cwd: SHINOBI_HOME, env, timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024, shell: IS_WIN },
      (err, stdout, stderr) => {
        let spawnError: string | undefined;
        if (err) {
          if ((err as any).killed) timedOut = true;
          else spawnError = err.message; // ENOENT, exit!=0, etc. — surfacearlo, no tragarlo
        }
        // execFile mata el hijo al timeout, pero en Windows puede dejar el ÁRBOL
        // (tsx/node) vivo → mátalo explícitamente. Y desregistra el pid.
        if (timedOut && child.pid) killTree(child.pid);
        if (child.pid) liveAgentPids.delete(child.pid);
        resolveP({ stdout: stdout || '', stderr: stderr || '', timedOut, spawnError });
      });
    if (child.pid) liveAgentPids.add(child.pid);
  });
}

async function runShinobi(prompt: string, env: NodeJS.ProcessEnv): Promise<{ output: string; timedOut: boolean; steps: number; tools: string[]; error?: string }> {
  // Prompt por fichero temporal (evita quoting en shell de Windows).
  const dir = mkdtempSync(join(tmpdir(), 'gaia-prompt-'));
  const pf = join(dir, 'prompt.txt');
  writeFileSync(pf, prompt, 'utf-8');
  let output = ''; let steps = 0; let tools: string[] = []; let error: string | undefined;
  try {
    const r = await run('npx', ['tsx', ONESHOT, '--prompt-file', pf], perTaskTimeoutMs, env);
    try {
      const line = r.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop() ?? '{}';
      const j = JSON.parse(line);
      output = String(j.output ?? '').trim();
      tools = Array.isArray(j.toolCalls) ? j.toolCalls.map(String) : [];
      steps = tools.length;
      if (j.error && !output) error = String(j.error);
    } catch { output = r.stdout.trim().slice(0, 2000); }
    if (!output && !error) error = r.spawnError ?? (r.stderr ? r.stderr.trim().slice(-300) : 'salida vacía');
    return { output, timedOut: r.timedOut, steps, tools, error };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

/** Coste acumulado de la API key en OpenRouter (USD). -1 si no se pudo medir. */
async function queryOpenRouterUsage(key: string): Promise<number> {
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/auth/key', { headers: { Authorization: `Bearer ${key}` } });
    if (!resp.ok) return -1;
    const data = await resp.json() as { data?: { usage?: number } };
    return data.data?.usage ?? -1;
  } catch { return -1; }
}

function estimateCostUsd(tIn: number, tOut: number): number {
  return tIn * PRICE_IN_PER_TOK + tOut * PRICE_OUT_PER_TOK;
}

/**
 * ¿El error es de INFRAESTRUCTURA (excluir) o del AGENTE (cuenta como miss)?
 * Infra = provider/red/config/spawn → no es culpa de la capacidad del agente.
 * El agente que agota iteraciones sin responder SÍ es un fallo real (miss).
 */
function isInfraError(err: string | undefined): boolean {
  if (!err) return false;
  const e = err.toLowerCase();
  return /invalid model id|no key|api[_ ]?key|unauthorized|\b401\b|\b402\b|\b403\b|\b5\d{2}\b/.test(e)
    || /econnrefused|enotfound|etimedout|socket hang up|connection (error|reset|closed)|network/.test(e)
    || /enoent|spawn|command not found|cannot find module/.test(e)
    || /rate[\s_-]?limit|too many requests|insufficient credits|quota/.test(e);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const tasks = loadTasks(args);
  const totalRuns = tasks.length * args.runs;

  console.log(`\nGAIA cata · ${tasks.length} tareas × ${args.runs} run = ${totalRuns} ejecuciones`);
  console.log(`Niveles=${args.levels.join(',')} · sin adjuntos=${!args.withAttachments} · modelo=${MODEL}`);
  console.log(`Metadata=${args.metadata}`);
  const byLevel: Record<string, number> = {};
  for (const t of tasks) byLevel[String(t.Level)] = (byLevel[String(t.Level)] ?? 0) + 1;
  console.log(`Reparto por nivel: ${JSON.stringify(byLevel)}\n`);

  if (args.dryRun) {
    // Estimación con cifras agénticas del setup previo (L1 ~35K/4K, L2 ~90K/9K).
    const est: Record<string, { in: number; out: number }> = { '1': { in: 35000, out: 4000 }, '2': { in: 90000, out: 9000 }, '3': { in: 180000, out: 15000 } };
    let total = 0;
    for (const t of tasks) { const e = est[String(t.Level)] ?? est['2']; total += estimateCostUsd(e.in, e.out); }
    console.log('— DRY RUN (sin API) — tareas seleccionadas:');
    tasks.forEach((t, i) => console.log(`  [${i + 1}] L${t.Level} ${t.task_id} · ${t.Question.slice(0, 80).replace(/\s+/g, ' ')}…`));
    console.log(`\nEstimación coste central: $${(total * args.runs).toFixed(4)} · pesimista ×2.5: $${(total * args.runs * 2.5).toFixed(4)}`);
    console.log(`(Extrapolado a 495 runs = 165 tareas × 3: ver reporte de cata.)`);
    console.log('\nPara lanzar de verdad: quita --dry-run (requiere OPENROUTER_API_KEY y OK del operador).');
    return;
  }

  const orKey = process.env.OPENROUTER_API_KEY;
  if (!orKey) { console.error('OPENROUTER_API_KEY ausente — requerido para la tanda real'); process.exit(1); }

  // Limpieza ante interrupción: el runner POSEE el Chrome dedicado y los agentes.
  // Parar la tanda (Ctrl-C/SIGTERM) no debe dejar NADA vivo.
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
    process.on(sig, () => { console.error(`\n[cleanup] ${sig} — matando Chrome dedicado + agentes…`); cleanup(); process.exit(130); });
  }

  // Chrome headless DEDICADO (no el del usuario): el agente se conecta a ESTE vía
  // SHINOBI_BROWSER_CDP_URL. Sin ventana en el escritorio, puerto CDP ≠ 9222.
  console.log(`🌐 Lanzando Chrome headless dedicado (modelo=${MODEL})…`);
  headlessChrome = await launchHeadlessChrome();
  console.log(`   CDP: ${headlessChrome.cdpUrl} (pid ${headlessChrome.pid})`);

  // Watchdog DETACHED: si matan al runner a la fuerza (los handlers de señal no
  // corren), él mata el Chrome dedicado + los agentes. Cero huérfanos garantizado.
  {
    const wd = spawn('node', [resolve(__dirname, 'watchdog.mjs'), String(process.pid), String(headlessChrome.pid)],
      { detached: true, stdio: 'ignore', windowsHide: true });
    wd.unref();
    watchdogPid = wd.pid;
    console.log(`   watchdog: pid ${watchdogPid} (vigila al runner ${process.pid})`);
  }

  const env = {
    ...process.env,
    OPENROUTER_API_KEY: orKey,
    // SHINOBI_BENCH=1 hace que el ejecutor fije el routing DENTRO de main()
    // (gana a cualquier dotenv override:true en import). Un solo provider/modelo.
    SHINOBI_BENCH: '1',
    GAIA_MODEL: MODEL,
    SHINOBI_PROVIDER: 'openrouter',
    SHINOBI_MODEL_DEFAULT: MODEL,
    SHINOBI_FAILOVER_CHAIN: 'openrouter',
    // El agente se conecta a NUESTRO Chrome headless (no auto-lanza el suyo, no
    // toca el Chrome del usuario).
    SHINOBI_BROWSER_CDP_URL: headlessChrome.cdpUrl,
    // Búsqueda headless-friendly (Bing degrada en headless).
    SHINOBI_SEARCH_ENGINE: 'ddg',
    // Navegación rápida (networkidle consume 45s/página).
    SHINOBI_NAV_WAIT: 'domcontentloaded',
    SHINOBI_NAV_TIMEOUT_MS: '20000',
    SHINOBI_NAV_SETTLE_MS: '1200',
    SHINOBI_MAX_ITERATIONS: process.env.SHINOBI_MAX_ITERATIONS ?? '12',
    // El agente sale LIMPIO por su deadline interno 25s antes del hard-timeout
    // del runner → no hay que matar el árbol (cero huérfanos por timeout).
    SHINOBI_TASK_DEADLINE_MS: String(Math.max(30000, perTaskTimeoutMs - 25000)),
    // Temperatura baja (determinismo). El ResearchAgent conserva su budget de
    // PRODUCCIÓN (SHINOBI_RESEARCH_BUDGET_MS, default 90s) — no lo calibramos a GAIA.
    SHINOBI_TEMPERATURE: process.env.SHINOBI_TEMPERATURE ?? '0',
  };

  let idx = 0; let costAccum = 0;
  for (const task of tasks) {
    // El ejecutor (gaia_agent.ts) añade GAIA_SYSTEM_PROMPT como system; aquí va
    // la pregunta SOLA como mensaje de usuario.
    const prompt = task.Question;
    for (let runN = 1; runN <= args.runs; runN++) {
      idx++;
      const costBefore = await queryOpenRouterUsage(orKey);
      const t0 = Date.now();
      let cell: Cell;
      try {
        const r = await runShinobi(prompt, env);
        const elapsedMs = Date.now() - t0;
        await new Promise((res) => setTimeout(res, 3000)); // latencia de facturación
        const costAfter = await queryOpenRouterUsage(orKey);
        const costUsdReal = costBefore >= 0 && costAfter >= 0 ? Math.max(0, costAfter - costBefore) : null;
        if (costUsdReal != null) costAccum += costUsdReal;

        const emptyOut = r.output.trim() === '';
        // INFRA_FAIL (excluido) solo si: timeout, o salida vacía POR error de
        // infra/provider. Si el agente corrió y no respondió (p.ej. max
        // iterations), es un MISS real del agente, no infra.
        if (r.timedOut || (emptyOut && isInfraError(r.error))) {
          cell = {
            taskId: task.task_id, level: String(task.Level), run: runN, expected: task['Final answer'],
            rawAnswer: '', rawOutput: (r.output || '').slice(0, 400), match: false, status: 'INFRA_FAIL',
            elapsedMs, steps: r.steps, tools: r.tools, approxTokensIn: approxTok(prompt), approxTokensOut: approxTok(r.output),
            costUsdReal, error: r.timedOut ? 'timeout' : (r.error ?? 'infra'),
          };
        } else {
          const answer = extractFinalAnswer(r.output);
          const match = emptyOut ? false : gaiaScorer(answer, task['Final answer']);
          cell = {
            taskId: task.task_id, level: String(task.Level), run: runN, expected: task['Final answer'],
            rawAnswer: answer, rawOutput: r.output.slice(0, 400), match, status: 'OK', elapsedMs,
            steps: r.steps, tools: r.tools, approxTokensIn: approxTok(prompt), approxTokensOut: approxTok(r.output), costUsdReal,
            error: emptyOut ? (r.error ?? 'agente sin respuesta final') : undefined,
          };
        }
      } catch (e: any) {
        cell = {
          taskId: task.task_id, level: String(task.Level), run: runN, expected: task['Final answer'],
          rawAnswer: '', rawOutput: '', match: false, status: 'INFRA_FAIL', elapsedMs: Date.now() - t0,
          steps: 0, approxTokensIn: 0, approxTokensOut: 0, costUsdReal: null, error: e?.message ?? String(e),
        };
      }
      appendFileSync(args.out, JSON.stringify(cell) + '\n', 'utf-8');
      const tag = cell.status === 'INFRA_FAIL' ? 'INFRA_FAIL' : (cell.match ? 'MATCH' : 'miss');
      console.log(`[${idx}/${totalRuns}] L${cell.level} ${task.task_id} r${runN} · ${tag} · ${cell.elapsedMs}ms · ${cell.steps} pasos · $${(cell.costUsdReal ?? 0).toFixed(6)} · ans=${JSON.stringify(cell.rawAnswer.slice(0, 40))} exp=${JSON.stringify(cell.expected)}`);

      if (costAccum > args.budget) {
        console.error(`\n⛔ Presupuesto superado ($${costAccum.toFixed(4)} > $${args.budget}). Abortando con resultados parciales en ${args.out}.`);
        cleanup();
        process.exit(3);
      }
    }
  }

  // Resumen
  const cells = readFileSync(args.out, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Cell);
  const ok = cells.filter((c) => c.status === 'OK');
  const infra = cells.filter((c) => c.status === 'INFRA_FAIL');
  const matches = ok.filter((c) => c.match).length;
  const realCost = cells.reduce((s, c) => s + (c.costUsdReal ?? 0), 0);
  const avgSteps = ok.length ? ok.reduce((s, c) => s + c.steps, 0) / ok.length : 0;
  const avgMs = ok.length ? ok.reduce((s, c) => s + c.elapsedMs, 0) / ok.length : 0;
  console.log('\n══════════ CATA GAIA — RESUMEN ══════════');
  console.log(`Aciertos: ${matches}/${ok.length} válidos (${infra.length} INFRA_FAIL excluidos)`);
  for (const lvl of [...new Set(cells.map((c) => c.level))].sort()) {
    const okL = ok.filter((c) => c.level === lvl);
    console.log(`  L${lvl}: ${okL.filter((c) => c.match).length}/${okL.length}`);
  }
  console.log(`Coste REAL total (delta OpenRouter): $${realCost.toFixed(6)}`);
  console.log(`Coste REAL por tarea (media): $${(ok.length ? realCost / ok.length : 0).toFixed(6)}`);
  console.log(`Extrapolación a 495 runs (165×3): $${(ok.length ? (realCost / ok.length) * 495 : 0).toFixed(4)}`);
  console.log(`Pasos/tarea (media): ${avgSteps.toFixed(1)} · Tiempo/tarea (media): ${(avgMs / 1000).toFixed(1)}s`);
  console.log(`Tokens (APROX, el agente no expone reales): in≈${ok.reduce((s, c) => s + c.approxTokensIn, 0)} out≈${ok.reduce((s, c) => s + c.approxTokensOut, 0)}`);
  console.log(`Resultados: ${args.out}`);
}

main()
  .then(() => { cleanup(); process.exit(0); })
  .catch((e) => { console.error('cata GAIA crashed:', e?.stack ?? e); cleanup(); process.exit(2); });
