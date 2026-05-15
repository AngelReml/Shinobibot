#!/usr/bin/env node
/**
 * FASE V6 — benchmark REAL: Shinobi vs Hermes vs OpenClaw.
 *
 * Corre en el Contabo (donde están los 3 agentes instalados). Para
 * cada tarea, invoca los 3 agentes con el MISMO modelo
 * (openai/gpt-4o-mini vía OpenRouter) y mide:
 *   - success    : el check de la tarea pasa
 *   - elapsedMs  : tiempo de pared
 *   - toolCalls  : nº de tool calls (cuando el agente lo expone)
 *   - output     : texto final
 *
 * 1 run por celda (no 3-para-mediana) — decisión de coste/tiempo,
 * declarada sin maquillar en BENCHMARK_M3_REAL.md.
 *
 * Salida: scripts/sprintV6/results.json
 */

import { execFile } from 'child_process';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHINOBI_HOME = resolve(__dirname, '../..');
const MODEL = 'openai/gpt-4o-mini';

interface Task {
  id: string;
  category: string;
  prompt: string;
  check: (out: string, toolCalls: string[]) => boolean;
}

// 20 tareas checkables sin LLM (regex/match). Comparables entre agentes.
const TASKS: Task[] = [
  { id: 'parse-json', category: 'parsing', prompt: 'Extract the field user.email from this JSON and reply with only the value: {"user":{"email":"foo@bar.com","name":"x"}}', check: (o) => /foo@bar\.com/.test(o) },
  { id: 'parse-csv', category: 'parsing', prompt: 'How many data rows (excluding header) in this CSV? Reply with just the number.\nname,age\nalice,30\nbob,40\ncarol,25', check: (o) => /\b3\b/.test(o) },
  { id: 'parse-version', category: 'parsing', prompt: 'Given version 1.2.3, reply with only the next patch version.', check: (o) => /\b1\.2\.4\b/.test(o) },
  { id: 'parse-yaml', category: 'parsing', prompt: 'In this YAML, what is the value of role? Reply with just the value.\nname: alice\nrole: admin', check: (o) => /admin/i.test(o) },
  { id: 'reason-arith', category: 'reasoning', prompt: 'What is 17 * 23 + 5? Reply with just the number.', check: (o) => /\b396\b/.test(o) },
  { id: 'reason-logic', category: 'reasoning', prompt: 'If A implies B, B implies C, and A is true, is C true? Reply yes or no.', check: (o) => /\byes\b/i.test(o) && !/\bno\b/i.test(o) },
  { id: 'reason-reverse', category: 'reasoning', prompt: 'Reverse the string "shinobi" and reply with only the result.', check: (o) => /ibonihs/i.test(o) },
  { id: 'reason-prime', category: 'reasoning', prompt: 'Is 17 a prime number? Reply yes or no.', check: (o) => /\byes\b/i.test(o) && !/\bno\b/i.test(o) },
  { id: 'plan-steps', category: 'planning', prompt: 'List exactly 3 numbered steps to create a git repository. Number them 1, 2, 3.', check: (o) => /1[.)]/.test(o) && /2[.)]/.test(o) && /3[.)]/.test(o) },
  { id: 'plan-deps', category: 'planning', prompt: 'To make tea you need: boiling water, a cup, a teabag. List the steps in dependency order.', check: (o) => o.toLowerCase().indexOf('water') < o.toLowerCase().indexOf('teabag') },
  { id: 'plan-prio', category: 'planning', prompt: 'You have 1 hour and 3 tasks: urgent, important, optional. Which do you do first? Reply with one word.', check: (o) => /urgent/i.test(o) },
  { id: 'mem-recall', category: 'memory', prompt: 'Remember: my favorite color is violet. Now answer: what is my favorite color?', check: (o) => /violet/i.test(o) },
  { id: 'mem-contra', category: 'memory', prompt: 'My name is Pedro. Earlier I said my name is Pablo. Point out the contradiction.', check: (o) => /contradict|differ|inconsist|changed/i.test(o) },
  { id: 'mem-pref', category: 'memory', prompt: 'I do not like coffee. Should you offer me coffee? Reply yes or no.', check: (o) => /\bno\b/i.test(o) },
  { id: 'tool-shell', category: 'tool_use', prompt: 'Run the shell command `echo shinobi-bench-ok` and report its exact output.', check: (o) => /shinobi-bench-ok/.test(o) },
  { id: 'tool-date', category: 'tool_use', prompt: 'Use a tool to get the current year and reply with just the 4-digit year.', check: (o) => /20\d\d/.test(o) },
  { id: 'tool-calc', category: 'tool_use', prompt: 'Compute 987654 * 321 using a tool and reply with just the number.', check: (o) => /317,?076,?934/.test(o.replace(/\s/g, '')) },
  { id: 'recover-retry', category: 'recovery', prompt: 'If your first tool call fails with ENOENT, what do you do? Answer in one sentence.', check: (o) => /retr|verif|check|altern|different path/i.test(o) },
  { id: 'recover-failover', category: 'recovery', prompt: 'If the LLM provider returns HTTP 429, what strategy do you apply? Answer briefly.', check: (o) => /failover|another provider|backoff|wait|retry/i.test(o) },
  { id: 'recover-loop', category: 'recovery', prompt: 'You have retried the same tool with the same args 5 times with identical results. What do you decide?', check: (o) => /abort|stop|change|different|ask|human|give up/i.test(o) },
];

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number }): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolveP) => {
    const child = execFile(cmd, args, {
      cwd: opts.cwd, env: opts.env, timeout: opts.timeoutMs, maxBuffer: 10 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      resolveP({ stdout: stdout || '', stderr: stderr || '', code: err ? (err as any).code ?? 1 : 0 });
    });
    void child;
  });
}

async function runHermes(prompt: string, env: NodeJS.ProcessEnv): Promise<{ output: string; toolCalls: string[]; ms: number }> {
  const t0 = Date.now();
  const r = await run('/opt/hermes-venv/bin/hermes',
    ['-z', prompt, '-m', `openrouter/${MODEL}`, '--provider', 'openrouter', '--yolo'],
    { env, timeoutMs: 180000 });
  return { output: (r.stdout || r.stderr).trim(), toolCalls: [], ms: Date.now() - t0 };
}

async function runOpenClaw(prompt: string, env: NodeJS.ProcessEnv, sid: string): Promise<{ output: string; toolCalls: string[]; ms: number }> {
  const t0 = Date.now();
  const r = await run('openclaw',
    ['agent', '--local', '--agent', 'main', '--session-id', sid,
     '--model', `openrouter/${MODEL}`, '-m', prompt, '--json'],
    { env, timeoutMs: 180000 });
  let output = ''; let toolCalls: string[] = [];
  try {
    const j = JSON.parse(r.stdout);
    output = (j.payloads?.[0]?.text ?? '').trim();
    const tools = j.meta?.toolSummary?.tools;
    if (Array.isArray(tools)) toolCalls = tools;
  } catch { output = r.stdout.trim().slice(0, 500); }
  return { output, toolCalls, ms: Date.now() - t0 };
}

async function runShinobi(prompt: string, env: NodeJS.ProcessEnv): Promise<{ output: string; toolCalls: string[]; ms: number }> {
  const t0 = Date.now();
  const r = await run('npx',
    ['tsx', 'scripts/sprintV6/shinobi_oneshot.ts', prompt],
    { cwd: SHINOBI_HOME, env, timeoutMs: 240000 });
  let output = ''; let toolCalls: string[] = [];
  try {
    const line = r.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop() ?? '{}';
    const j = JSON.parse(line);
    output = String(j.output ?? '').trim();
    toolCalls = Array.isArray(j.toolCalls) ? j.toolCalls : [];
  } catch { output = r.stdout.trim().slice(0, 500); }
  return { output, toolCalls, ms: Date.now() - t0 };
}

async function main(): Promise<void> {
  const orKey = process.env.OPENROUTER_API_KEY;
  if (!orKey) { console.error('OPENROUTER_API_KEY ausente'); process.exit(1); }
  const baseEnv = { ...process.env, OPENROUTER_API_KEY: orKey, SHINOBI_PROVIDER: 'openrouter' };

  const agents = [
    { name: 'Shinobi', fn: (p: string, i: number) => runShinobi(p, baseEnv) },
    { name: 'Hermes', fn: (p: string, i: number) => runHermes(p, baseEnv) },
    { name: 'OpenClaw', fn: (p: string, i: number) => runOpenClaw(p, baseEnv, `bench-${i}`) },
  ];

  const results: any[] = [];
  let idx = 0;
  for (const task of TASKS) {
    for (const agent of agents) {
      idx++;
      process.stdout.write(`[${idx}/${TASKS.length * 3}] ${task.id} · ${agent.name} … `);
      let cell: any;
      try {
        const r = await agent.fn(task.prompt, idx);
        const success = task.check(r.output, r.toolCalls);
        cell = {
          taskId: task.id, category: task.category, agent: agent.name,
          success, elapsedMs: r.ms, toolCalls: r.toolCalls.length,
          outputPreview: r.output.slice(0, 160).replace(/\n/g, ' '),
        };
        process.stdout.write(`${success ? 'OK' : 'FAIL'} ${r.ms}ms\n`);
      } catch (e: any) {
        cell = {
          taskId: task.id, category: task.category, agent: agent.name,
          success: false, elapsedMs: 0, toolCalls: 0,
          error: e?.message ?? String(e), outputPreview: '',
        };
        process.stdout.write(`ERROR\n`);
      }
      results.push(cell);
    }
  }

  const outPath = resolve(__dirname, 'results.json');
  writeFileSync(outPath, JSON.stringify({ model: MODEL, runAt: new Date().toISOString(), results }, null, 2), 'utf-8');
  console.log(`\nResultados → ${outPath}`);

  // Resumen rápido.
  for (const agent of ['Shinobi', 'Hermes', 'OpenClaw']) {
    const cells = results.filter((r) => r.agent === agent);
    const ok = cells.filter((r) => r.success).length;
    const avgMs = Math.round(cells.reduce((a, r) => a + r.elapsedMs, 0) / cells.length);
    console.log(`  ${agent}: ${ok}/${cells.length} OK · ${avgMs}ms medio`);
  }
}

main().catch((e) => { console.error('benchmark crashed:', e?.stack ?? e); process.exit(2); });
