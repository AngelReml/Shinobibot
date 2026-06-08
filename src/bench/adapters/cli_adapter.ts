// src/bench/adapters/cli_adapter.ts
//
// Adaptador genérico para correr un agente EXTERNO por CLI (Hermes, OpenClaw)
// como subproceso, en el workdir de la tarea. Es la vía para meter a los
// competidores en el harness en condiciones idénticas. Se SALTA limpio si no
// está configurado/instalado (isAvailable=false), así el benchmark corre con lo
// que haya y queda listo para los demás cuando el operador aporte binarios+keys.

import { spawn } from 'child_process';
import type { AgentAdapter, AgentRunResult, BenchTask, TaskContext } from '../types.js';

export interface CliAdapterConfig {
  id: string;
  /** Binario a ejecutar (p. ej. 'hermes', 'openclaw', 'node'). */
  command: string;
  /**
   * Args estáticos. Placeholders sustituidos por tarea: '{prompt}' y '{workdir}'.
   * Si no incluye '{prompt}', el prompt se pasa por stdin.
   */
  args?: string[];
  /** Cómo pasar el prompt: por arg ('{prompt}' en args) o por stdin. Default auto. */
  promptVia?: 'arg' | 'stdin';
  /** Probe de disponibilidad. Default: intenta `command --version`. */
  available?: () => Promise<boolean>;
  timeoutMs?: number;
  /** Env extra para el subproceso (API keys, etc.). */
  env?: Record<string, string>;
}

function runProc(
  command: string, args: string[], opts: { cwd: string; input?: string; timeoutMs: number; env?: Record<string, string> },
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      windowsHide: true,
    });
    let stdout = ''; let stderr = ''; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { child.kill('SIGKILL'); } catch { /* */ } }, opts.timeoutMs);
    child.stdout?.on('data', (d) => { stdout += String(d); });
    child.stderr?.on('data', (d) => { stderr += String(d); });
    child.on('error', () => { clearTimeout(timer); resolve({ code: 127, stdout, stderr, timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr, timedOut }); });
    if (opts.input !== undefined) { try { child.stdin?.write(opts.input); child.stdin?.end(); } catch { /* */ } }
  });
}

export class CliAdapter implements AgentAdapter {
  readonly id: string;
  constructor(private readonly cfg: CliAdapterConfig) {
    this.id = cfg.id;
  }

  async isAvailable(): Promise<boolean> {
    if (this.cfg.available) return this.cfg.available();
    const r = await runProc(this.cfg.command, ['--version'], { cwd: process.cwd(), timeoutMs: 8000, env: this.cfg.env });
    return r.code === 0;
  }

  async run(task: BenchTask, ctx: TaskContext): Promise<AgentRunResult> {
    const timeoutMs = task.limits?.timeoutMs ?? this.cfg.timeoutMs ?? 300_000;
    const rawArgs = this.cfg.args ?? [];
    const usesArgPrompt = this.cfg.promptVia === 'arg' || rawArgs.some((a) => a.includes('{prompt}'));
    const args = rawArgs.map((a) => a.replace('{prompt}', task.prompt).replace('{workdir}', ctx.workdir));
    const input = usesArgPrompt ? undefined : task.prompt;

    const t0 = Date.now();
    const r = await runProc(this.cfg.command, args, { cwd: ctx.workdir, input, timeoutMs, env: this.cfg.env });
    return {
      finalText: r.stdout.trim(),
      ok: r.code === 0 && !r.timedOut,
      iterations: 0, // un CLI externo no expone su nº de iteraciones de forma genérica
      toolsUsed: [],
      durationMs: Date.now() - t0,
      error: r.timedOut ? `timeout tras ${timeoutMs}ms` : (r.code !== 0 ? `exit ${r.code}: ${r.stderr.slice(0, 200)}` : undefined),
    };
  }
}
