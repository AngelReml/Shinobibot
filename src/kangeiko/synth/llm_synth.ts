// P5 — sintetizador REAL respaldado por LLM (opt-in, default OFF).
//
// El AsyncSynthesizer que pide CÓDIGO a un modelo, lo pasa por el gate de seguridad
// (guardedCompile → scanForbidden) y lo materializa en la jaula (CodeRunner). El LLM y
// el runner se INYECTAN: real = providers + isolated_runner; test = fakes deterministas.
//
// Default OFF (opt-in): sin `enabled`, NO se llama al modelo (cero gasto sin permiso
// explícito) y se lanza. La ADOPCIÓN de una candidata certificada sigue siendo
// human-gated (fuera de este fichero). Este código NUNCA adopta ni gasta por su cuenta.

import type { AsyncSynthesizer } from '../fabricate_async.js';
import type { OracleTask } from '../held_out_oracle.js';
import { guardedCompile, type CodeRunner } from './safe_synth.js';

/** Pide CÓDIGO (texto) a un LLM. Real = adapter sobre providers; test = fake. */
export type LlmFn = (prompt: string) => Promise<string>;

export interface LlmSynthDeps<I, O> {
  readonly llm: LlmFn;
  readonly runner: CodeRunner;
  /** Opt-in. Sin esto (default) NO se llama al LLM: cero gasto. */
  readonly enabled?: boolean;
  readonly buildPrompt?: (train: readonly OracleTask<I, O>[]) => string;
}

/** Prompt por defecto: pide una función pura ESM sin efectos a partir de los ejemplos. */
export function defaultBuildPrompt<I, O>(train: readonly OracleTask<I, O>[]): string {
  const ejemplos = train
    .map((t) => `  input=${JSON.stringify(t.input)} => output=${JSON.stringify(t.expected)}`)
    .join('\n');
  return [
    'Escribe UNA función pura de JavaScript que transforme input en output según los ejemplos.',
    'Requisitos ESTRICTOS:',
    '- Exponla exactamente como: export default (input) => output',
    '- SIN efectos: prohibido require/import/process/eval/Function/fetch/fs/red/globalThis.',
    '- Determinista y total (no lanzar en entradas válidas).',
    'Ejemplos:',
    ejemplos,
    'Devuelve SOLO el código, sin explicación.',
  ].join('\n');
}

/** Quita fences ```…``` si el modelo envolvió el código. */
export function stripFences(s: string): string {
  const m = s.match(/^\s*```[a-zA-Z]*\n([\s\S]*?)\n```\s*$/);
  return (m ? m[1] : s).trim();
}

/**
 * Sintetizador real: LLM → gate scanForbidden → runner (jaula). Default OFF.
 * Si `enabled` no está, lanza SIN llamar al LLM (cero gasto). Si el código del modelo
 * es inseguro, `guardedCompile` lanza `SynthesisRejected` y el runner no se invoca.
 */
export class LlmSynthesizer<I, O> implements AsyncSynthesizer<I, O> {
  private readonly deps: LlmSynthDeps<I, O>;
  constructor(deps: LlmSynthDeps<I, O>) { this.deps = deps; }

  async synthesize(train: readonly OracleTask<I, O>[]): Promise<(input: I) => O> {
    if (!this.deps.enabled) {
      throw new Error('LlmSynthesizer deshabilitado (opt-in): sin permiso explícito no se llama al LLM (cero gasto).');
    }
    const build = this.deps.buildPrompt ?? defaultBuildPrompt<I, O>;
    const code = stripFences(await this.deps.llm(build(train)));
    return guardedCompile<I, O>(code, this.deps.runner);
  }
}
