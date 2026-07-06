// P5 — fábrica del sintetizador por defecto: OPT-IN, default OFF.
//
// Une el LLM real (providers) con el runner real (isolated-vm) SOLO si el operador
// activa el flag `SHINOBI_SYNTH_LLM=1`. Sin el flag, `enabled` es false → al usarse
// lanza SIN llamar al LLM (cero gasto) y sin ejecutar código generado. La ADOPCIÓN de
// una candidata certificada sigue siendo human-gated (fuera de aquí). ⚠ El runner
// isolated-vm es nativo y NO está verificado en Linux: pending Windows.

import { LlmSynthesizer, type LlmFn } from './llm_synth.js';
import { IsolatedVmRunner } from './isolated_runner.js';
import { invokeLLM } from '../../providers/provider_router.js';
import type { AsyncSynthesizer } from '../fabricate_async.js';

/** ¿El operador activó el sintetizador LLM? Opt-in explícito, default OFF. */
export function synthEnabled(): boolean {
  return process.env.SHINOBI_SYNTH_LLM === '1';
}

/** Adapter real: pide CÓDIGO al LLM vía providers. Solo se invoca si el flag está on. */
const providerLlm: LlmFn = async (prompt: string): Promise<string> => {
  const res = await invokeLLM({ messages: [{ role: 'user', content: prompt }] });
  if (!res.success) throw new Error(`LLM falló al sintetizar: ${res.error ?? 'desconocido'}`);
  return res.output;
};

/**
 * AsyncSynthesizer real SOLO si `SHINOBI_SYNTH_LLM=1`. Sin el flag, `enabled=false` ⇒
 * al usarse lanza sin llamar al LLM ni ejecutar nada. Construir `IsolatedVmRunner` es
 * inerte (no crea isolates hasta `compile`).
 */
export function createDefaultSynthesizer<I, O>(): AsyncSynthesizer<I, O> {
  return new LlmSynthesizer<I, O>({ llm: providerLlm, runner: new IsolatedVmRunner(), enabled: synthEnabled() });
}
