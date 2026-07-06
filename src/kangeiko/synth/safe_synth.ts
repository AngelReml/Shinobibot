// P5 — gate de seguridad del sintetizador + contrato de ejecución de código foráneo.
//
// El sintetizador real recibe CÓDIGO de un LLM. Antes de ejecutar una sola línea, ese
// código pasa por `scanForbidden` (el MISMO guard AST que confina los plugins en
// plugin_loader.ts, ALTA-02): si aparece `process`/`require`/`eval`/`Function`/red/fs/
// acceso computado por string/import dinámico, o no parsea, se RECHAZA fail-closed. Una
// sola puerta de confinamiento, sin segunda gramática.
//
// Contrato del código sintetizado: expone la transformación como `export default
// (input) => output` (ESM) — nunca `globalThis` (prohibido por el guard). El runner
// real (isolated_runner.ts) lo compila y ejecuta en la jaula; aquí solo se decide si
// el código PUEDE llegar al runner.

import { scanForbidden } from '../../confine/ast_guard.js';

/**
 * Compila código sintetizado a una función pura. La impl REAL corre el código en
 * isolated-vm (nativo/Windows); en test se inyecta un runner fake. Esta capa NO
 * ejecuta código por sí misma — solo materializa la función tras pasar el gate.
 */
export interface CodeRunner {
  compile<I, O>(code: string): (input: I) => O;
}

/** El código fue rechazado por el guard AST antes de ejecutarse. Distinguible del resto. */
export class SynthesisRejected extends Error {
  readonly findings: string[];
  constructor(findings: string[]) {
    super(`código sintetizado rechazado por el guard AST (fail-closed): ${findings.join('; ')}`);
    this.name = 'SynthesisRejected';
    this.findings = findings;
  }
}

/**
 * EL gate: `scanForbidden` ANTES de compilar/ejecutar. Código inseguro ⇒ lanza
 * `SynthesisRejected` y el runner NUNCA se invoca. Solo código seguro llega al runner.
 * Puro salvo por la ejecución delegada al runner inyectado.
 */
export function guardedCompile<I, O>(code: string, runner: CodeRunner): (input: I) => O {
  const scan = scanForbidden(code);
  if (!scan.safe) throw new SynthesisRejected(scan.findings);
  return runner.compile<I, O>(code);
}
