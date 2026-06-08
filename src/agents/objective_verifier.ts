// src/agents/objective_verifier.ts
//
// Motor E1 — VERIFICACIÓN OBJETIVA.
//
// La auditoría real mostró que el verificador de Claude Code corre tests, pero
// conducido por prompt y apagado para terceros. Aquí la verificación objetiva es
// CÓDIGO y gate DURO: ejecuta comandos reales (typecheck, tests, lint) y su
// veredicto sale del exit code, no de la opinión de un LLM. Un modelo no puede
// "fingir" que los tests pasan. Es lo que vuelve medible el "% auto-corregido".

import { spawnSync } from 'child_process';

export interface ObjectiveCheck {
  /** Etiqueta legible (p. ej. "typecheck", "tests"). */
  label: string;
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
}

export interface ObjectiveCheckResult {
  label: string;
  passed: boolean;
  exitCode: number;
  output: string; // stderr+stdout recortado
}

/** Ejecuta los comandos y devuelve su resultado (exit 0 = pasó). No lanza. */
export function runObjectiveChecks(checks: ObjectiveCheck[]): ObjectiveCheckResult[] {
  return (checks ?? []).map((c) => {
    let exitCode = 1;
    let output = '';
    try {
      const r = spawnSync(c.command, c.args ?? [], {
        cwd: c.cwd,
        encoding: 'utf-8',
        timeout: c.timeoutMs ?? 60_000,
        windowsHide: true,
      });
      exitCode = r.status ?? (r.error ? 127 : 1);
      output = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(0, 500);
      if (r.error) output = `${output}\n${r.error.message}`.trim();
    } catch (e: any) {
      exitCode = 1;
      output = e?.message ?? String(e);
    }
    return { label: c.label, passed: exitCode === 0, exitCode, output };
  });
}

/** Resume los resultados en un veredicto {passed, issues} para el bucle de E1. */
export function objectiveVerdict(results: ObjectiveCheckResult[]): { passed: boolean; issues: string[] } {
  const failed = results.filter((r) => !r.passed);
  return {
    passed: failed.length === 0,
    issues: failed.map((r) => `[${r.label}] falló (exit ${r.exitCode}): ${r.output.split('\n').slice(0, 3).join(' ')}`),
  };
}
