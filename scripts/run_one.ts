// scripts/run_one.ts — runner HEADLESS de UNA tarea para lanzadores externos.
//
// Lo invoca un orquestador (p. ej. el run_bench.py de OpenGravity) como
// subproceso para correr shinobi sobre un prompt y obtener un resultado
// estandarizado + métricas + un PAQUETE DE PROVENANCE FIRMADO. Escribe el JSON a
// --out (no a stdout, que shinobi llena de logs).
//
//   tsx scripts/run_one.ts --prompt "..." --out result.json [--workdir DIR]
//                          [--task-id ID] [--verified] [--seed 42] [--model M]
//
// Forma de salida (compatible con run_inference de un adaptador de benchmark):
//   { task_id, model, seed, content, tool_calls, latency_ms, usage,
//     signature, iterations, loop_aborts, self_corrected, provenance }
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import '../src/tools/index.js';
import { ShinobiAdapter } from '../src/bench/index.js';
import { buildProvenancePackage } from '../src/agents/provenance.js';
import type { BenchTask, TaskContext } from '../src/bench/types.js';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  let prompt = arg('prompt');
  if (!prompt) { try { prompt = fs.readFileSync(0, 'utf-8').trim(); } catch { /* */ } }
  if (!prompt) { console.error('run_one: falta --prompt (o stdin)'); process.exit(2); }

  const out = arg('out');
  const taskId = arg('task-id') || 'adhoc';
  const seed = Number(arg('seed') || '42');
  const model = arg('model') || 'default';
  const workdir = arg('workdir') || fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-run-'));
  fs.mkdirSync(workdir, { recursive: true });

  const adapter = new ShinobiAdapter({ verified: has('verified') });
  const task: BenchTask = { id: taskId, category: 'autonomy', prompt: prompt!, check: async () => ({ pass: true, detail: '' }) };
  const ctx: TaskContext = { workdir, task };

  const t0 = Date.now();
  const run = await adapter.run(task, ctx);
  const latencyMs = Date.now() - t0;

  const provenance = buildProvenancePackage({
    taskId, prompt: prompt!, finalText: run.finalText,
    auditPath: run.auditPath, embedAudit: true,
  });

  const result = {
    task_id: taskId,
    model, seed,
    content: run.finalText,
    tool_calls: run.toolsUsed,
    latency_ms: run.durationMs || latencyMs,
    usage: run.cost ?? null,
    signature: provenance.signature, // firma verificable del paquete de provenance
    iterations: run.iterations,
    loop_aborts: run.metrics?.loopAborts ?? 0,
    self_corrected: run.selfCorrected ?? null,
    ok: run.ok,
    error: run.error ?? null,
    provenance,
  };

  const json = JSON.stringify(result, null, 2);
  if (out) { fs.writeFileSync(path.resolve(out), json, 'utf-8'); console.error(`[run_one] escrito ${out} (${taskId}, ${result.latency_ms}ms, ok=${run.ok})`); }
  else process.stdout.write(json + '\n');
}
main().catch((e) => { console.error('[run_one] THREW', e?.message ?? e); process.exit(1); });
