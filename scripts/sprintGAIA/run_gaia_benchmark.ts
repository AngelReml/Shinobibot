#!/usr/bin/env node
/**
 * GAIA benchmark — Shinobi vs Hermes vs OpenClaw sobre el validation set.
 *
 * Corre en el Contabo. Lee /opt/GAIA/2023/validation/metadata.jsonl,
 * invoca cada agente con el prompt oficial GAIA + la pregunta, extrae la
 * FINAL ANSWER y la compara con el matcher oficial (gaia_matcher.ts).
 *
 * Modelo: z-ai/glm-4.7-flash vía OpenRouter (mismo para los 3).
 *
 * Flags:
 *   --level N        solo tareas de ese nivel (1|2|3). Repetible.
 *   --limit N        máx tareas (tras filtrar por nivel).
 *   --runs N         runs por celda (default 3).
 *   --agents a,b     subconjunto de agentes (default los 3).
 *   --out FILE       jsonl de resultados parciales (append por ejecución).
 *
 * Persiste CADA ejecución (append) para no perder progreso.
 * INFRA_FAIL: timeout/crash del agente NO cuenta como fallo del agente.
 */

import { execFile } from 'child_process';
import { appendFileSync, readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { gaiaScorer, extractFinalAnswer, GAIA_SYSTEM_PROMPT } from './gaia_matcher.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHINOBI_HOME = resolve(__dirname, '../..');
const MODEL = 'z-ai/glm-4.7-flash';
const METADATA = '/opt/GAIA/2023/validation/metadata.jsonl';

interface GaiaTask {
  task_id: string;
  Question: string;
  Level: string;
  'Final answer': string;
  file_name: string;
}

interface Cell {
  taskId: string;
  level: string;
  agent: string;
  run: number;
  expected: string;
  rawAnswer: string;       // FINAL ANSWER extraída
  rawOutput: string;       // salida cruda (recortada)
  match: boolean;
  status: 'OK' | 'INFRA_FAIL';
  elapsedMs: number;
  approxTokens: number | null;
  error?: string;
}

function parseArgs(): { levels: string[]; limit: number; runs: number; agents: string[]; out: string } {
  const a = process.argv.slice(2);
  const levels: string[] = [];
  let limit = Infinity, runs = 3, out = resolve(__dirname, 'results-partial.jsonl');
  let agents = ['Shinobi', 'Hermes', 'OpenClaw'];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--level') levels.push(a[++i]);
    else if (a[i] === '--limit') limit = parseInt(a[++i], 10);
    else if (a[i] === '--runs') runs = parseInt(a[++i], 10);
    else if (a[i] === '--agents') agents = a[++i].split(',').map((s) => s.trim());
    else if (a[i] === '--out') out = resolve(a[++i]);
  }
  return { levels, limit, runs, agents, out };
}

function loadTasks(levels: string[], limit: number): GaiaTask[] {
  if (!existsSync(METADATA)) throw new Error(`metadata no encontrado: ${METADATA}`);
  const rows = readFileSync(METADATA, 'utf-8').split('\n').filter(Boolean)
    .map((l) => JSON.parse(l) as GaiaTask);
  let filtered = rows;
  if (levels.length > 0) filtered = filtered.filter((r) => levels.includes(String(r.Level)));
  return filtered.slice(0, limit);
}

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number }):
Promise<{ stdout: string; stderr: string; timedOut: boolean; code: number }> {
  return new Promise((resolveP) => {
    let timedOut = false;
    const child = execFile(cmd, args, {
      cwd: opts.cwd, env: opts.env, timeout: opts.timeoutMs, maxBuffer: 20 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err && (err as any).killed) timedOut = true;
      resolveP({ stdout: stdout || '', stderr: stderr || '', timedOut, code: err ? ((err as any).code ?? 1) : 0 });
    });
    void child;
  });
}

/** Estima tokens de un texto (~4 chars/token). */
function approxTok(s: string): number { return Math.ceil((s || '').length / 4); }

async function runHermes(prompt: string, env: NodeJS.ProcessEnv): Promise<{ output: string; timedOut: boolean; tokens: number | null }> {
  const r = await run('/opt/hermes-venv/bin/hermes',
    ['-z', prompt, '-m', MODEL, '--provider', 'openrouter', '--yolo'],
    { env, timeoutMs: 300000 });
  return { output: (r.stdout || r.stderr).trim(), timedOut: r.timedOut, tokens: null };
}

async function runOpenClaw(prompt: string, env: NodeJS.ProcessEnv, sid: string): Promise<{ output: string; timedOut: boolean; tokens: number | null }> {
  const r = await run('openclaw',
    ['agent', '--local', '--agent', 'main', '--session-id', sid,
     '--model', `openrouter/${MODEL}`, '-m', prompt, '--json'],
    { env, timeoutMs: 300000 });
  let output = ''; let tokens: number | null = null;
  try {
    const j = JSON.parse(r.stdout);
    output = (j.payloads?.[0]?.text ?? '').trim();
    const u = j.meta?.usage ?? j.meta?.tokenUsage;
    if (u && typeof u.total === 'number') tokens = u.total;
    else if (u && typeof u.totalTokens === 'number') tokens = u.totalTokens;
  } catch { output = r.stdout.trim().slice(0, 2000); }
  return { output, timedOut: r.timedOut, tokens };
}

async function runShinobi(prompt: string, env: NodeJS.ProcessEnv): Promise<{ output: string; timedOut: boolean; tokens: number | null }> {
  const r = await run('npx',
    ['tsx', 'scripts/sprintV6/shinobi_oneshot.ts', prompt],
    { cwd: SHINOBI_HOME, env, timeoutMs: 360000 });
  let output = '';
  try {
    const line = r.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop() ?? '{}';
    const j = JSON.parse(line);
    output = String(j.output ?? '').trim();
  } catch { output = r.stdout.trim().slice(0, 2000); }
  return { output, timedOut: r.timedOut, tokens: null };
}

async function main(): Promise<void> {
  const { levels, limit, runs, agents, out } = parseArgs();
  const orKey = process.env.OPENROUTER_API_KEY;
  if (!orKey) { console.error('OPENROUTER_API_KEY ausente'); process.exit(1); }
  const baseEnv = {
    ...process.env,
    OPENROUTER_API_KEY: orKey,
    SHINOBI_PROVIDER: 'openrouter',
    SHINOBI_MODEL_DEFAULT: MODEL,
  };

  const tasks = loadTasks(levels, limit);
  console.log(`GAIA: ${tasks.length} tareas · agentes=${agents.join(',')} · runs=${runs} · out=${out}`);

  const runners: Record<string, (p: string, i: number) => Promise<{ output: string; timedOut: boolean; tokens: number | null }>> = {
    Shinobi: (p) => runShinobi(p, baseEnv),
    Hermes: (p) => runHermes(p, baseEnv),
    OpenClaw: (p, i) => runOpenClaw(p, baseEnv, `gaia-${i}`),
  };

  let idx = 0;
  const total = tasks.length * agents.length * runs;
  for (const task of tasks) {
    const prompt = `${GAIA_SYSTEM_PROMPT}\n\nQuestion: ${task.Question}`;
    for (const agent of agents) {
      for (let runN = 1; runN <= runs; runN++) {
        idx++;
        const t0 = Date.now();
        let cell: Cell;
        try {
          const r = await runners[agent](prompt, idx);
          const elapsedMs = Date.now() - t0;
          if (r.timedOut) {
            cell = {
              taskId: task.task_id, level: String(task.Level), agent, run: runN,
              expected: task['Final answer'], rawAnswer: '', rawOutput: r.output.slice(0, 400),
              match: false, status: 'INFRA_FAIL', elapsedMs, approxTokens: null,
              error: 'timeout',
            };
          } else if (r.output.trim() === '') {
            // Salida vacía → el agente no emitió nada: error de modelo
            // (HTTP 500/429 aguas arriba) o crash. NO es un fallo de
            // respuesta del agente — se marca INFRA_FAIL.
            cell = {
              taskId: task.task_id, level: String(task.Level), agent, run: runN,
              expected: task['Final answer'], rawAnswer: '', rawOutput: '',
              match: false, status: 'INFRA_FAIL', elapsedMs, approxTokens: null,
              error: 'salida vacía (probable error de modelo/infra)',
            };
          } else {
            const answer = extractFinalAnswer(r.output);
            const match = gaiaScorer(answer, task['Final answer']);
            cell = {
              taskId: task.task_id, level: String(task.Level), agent, run: runN,
              expected: task['Final answer'], rawAnswer: answer,
              rawOutput: r.output.slice(0, 400),
              match, status: 'OK', elapsedMs,
              approxTokens: r.tokens ?? (approxTok(prompt) + approxTok(r.output)),
            };
          }
        } catch (e: any) {
          cell = {
            taskId: task.task_id, level: String(task.Level), agent, run: runN,
            expected: task['Final answer'], rawAnswer: '', rawOutput: '',
            match: false, status: 'INFRA_FAIL', elapsedMs: Date.now() - t0,
            approxTokens: null, error: e?.message ?? String(e),
          };
        }
        appendFileSync(out, JSON.stringify(cell) + '\n', 'utf-8');
        const tag = cell.status === 'INFRA_FAIL' ? 'INFRA_FAIL' : (cell.match ? 'MATCH' : 'miss');
        console.log(`[${idx}/${total}] L${cell.level} ${agent} r${runN} · ${tag} · ${cell.elapsedMs}ms · ans=${JSON.stringify(cell.rawAnswer.slice(0, 50))} exp=${JSON.stringify(cell.expected)}`);
      }
    }
  }
  console.log(`\nGAIA run completo. Resultados en ${out}`);
}

main().catch((e) => { console.error('gaia benchmark crashed:', e?.stack ?? e); process.exit(2); });
