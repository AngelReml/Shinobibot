// src/bench/adapters/competitors.ts
//
// Adaptadores REALES de los competidores para el harness (cierra el P3.3 que la
// auditoría de paridad dejó pendiente: "benchmark vs runtimes reales").
// Invocaciones verificadas leyendo SUS repos (escritorio del operador):
//
//   Hermes (Python, hermes_cli):  `hermes -z "<prompt>"`  → modo oneshot:
//        ejecuta un solo prompt e imprime SOLO el bloque final a stdout.
//        (OJO: en Hermes `-p` es el PERFIL, no el prompt. El prompt va en -z.)
//        Ref: hermes-agent-main/hermes_cli/oneshot.py:124 run_oneshot(prompt,...)
//             + main.py:9655 "-z","--oneshot" / :12388 dispatch.
//
//   OpenClaw (Node, mono-repo):   `openclaw agent --message "<prompt>"` → corre el
//        agente sobre un mensaje y emite la salida. `--json` para salida parseable.
//        Ref: openclaw_final_test/docs/cli/agent.md (ejemplos --message).
//
// REGLA DE HONESTIDAD (la más importante del benchmark): los TRES agentes deben
// correr el MISMO modelo, misma versión, misma temperatura. Si no, no mides el
// harness — mides quién pagó mejor modelo. El modelo se fija por agente FUERA de
// aquí (Shinobi: SHINOBI_* env / Hermes: `hermes model` o env / OpenClaw: config),
// y se DOCUMENTA en el fichero de resultados. Estas fábricas solo aceptan un env
// extra donde inyectar key/modelo y un override de comando para apuntar al install.

import { CliAdapter, type CliAdapterConfig } from './cli_adapter.js';

export interface CompetitorOptions {
  /** Override del binario/lanzador (p. ej. ruta absoluta o 'python -m hermes_cli'). */
  command?: string;
  /** Env extra: API keys, selección de modelo, HERMES_HOME, etc. */
  env?: Record<string, string>;
  /** Timeout por tarea (default 300s, igual para todos). */
  timeoutMs?: number;
  /** Args extra inyectados ANTES del prompt (p. ej. ['-p','bench'] perfil Hermes). */
  extraArgs?: string[];
}

/** Hermes en modo oneshot. `hermes [extra] -z "<prompt>"`. */
export function hermesRealAdapter(opts: CompetitorOptions = {}): CliAdapter {
  const cfg: CliAdapterConfig = {
    id: 'hermes',
    command: opts.command ?? 'hermes',
    args: [...(opts.extraArgs ?? []), '-z', '{prompt}'],
    promptVia: 'arg',
    timeoutMs: opts.timeoutMs ?? 300_000,
    env: opts.env,
    available: async () => probe(opts.command ?? 'hermes', ['--version'], opts.env),
  };
  return new CliAdapter(cfg);
}

/** OpenClaw en modo agente no interactivo. `openclaw agent --message "<prompt>"`. */
export function openClawRealAdapter(opts: CompetitorOptions = {}): CliAdapter {
  const cfg: CliAdapterConfig = {
    id: 'openclaw',
    command: opts.command ?? 'openclaw',
    args: ['agent', ...(opts.extraArgs ?? []), '--message', '{prompt}'],
    promptVia: 'arg',
    timeoutMs: opts.timeoutMs ?? 300_000,
    env: opts.env,
    available: async () => probe(opts.command ?? 'openclaw', ['--version'], opts.env),
  };
  return new CliAdapter(cfg);
}

/** Probe de disponibilidad: corre `<cmd> --version` y mira si sale limpio.
 *  Se importa spawn perezosamente para no acoplar el módulo al runtime. */
async function probe(command: string, args: string[], env?: Record<string, string>): Promise<boolean> {
  const { spawn } = await import('child_process');
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => { if (!done) { done = true; resolve(v); } };
    try {
      const c = spawn(command, args, { env: { ...process.env, ...env }, windowsHide: true });
      const t = setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* */ } finish(false); }, 8000);
      c.on('error', () => { clearTimeout(t); finish(false); });
      c.on('close', (code) => { clearTimeout(t); finish(code === 0); });
    } catch { finish(false); }
  });
}

/** Conveniencia: los tres adaptadores listos para `runBenchmark`. El de Shinobi se
 *  inyecta aparte (ShinobiAdapter) porque corre in-process, no por CLI. */
export function competitorRealAdapters(opts: { hermes?: CompetitorOptions; openclaw?: CompetitorOptions } = {}): CliAdapter[] {
  return [hermesRealAdapter(opts.hermes), openClawRealAdapter(opts.openclaw)];
}
