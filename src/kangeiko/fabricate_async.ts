// P5 (Kangeiko) — variante ASÍNCRONA del bucle de fabricación.
//
// El sintetizador SÍNCRONO (fabricate.ts) sirve para candidatas ya materializadas
// (fake en test, o funciones puras locales). El sintetizador REAL —un LLM que EMITE
// código, luego ejecutado en la jaula isolated-vm (P3)— es asíncrono: la llamada al
// modelo es de red. Este fichero añade ese camino SIN tocar el bucle sync ni su firma:
//   - `AsyncSynthesizer<I,O>.synthesize(train)` devuelve una Promise de la candidata.
//   - La candidata resuelta es SÍNCRONA `(input)=>O` (el runner real usa las APIs
//     *Sync de isolated-vm), así el oráculo held-out la certifica sin cambios.
// La certificación sigue siendo la MISMA (`certifyAgainstHeldOut`): fabrica con train,
// certifica con held-out, devuelve la candidata SOLO si se certificó. Sin adopción.

import type { OracleTask } from './held_out_oracle.js';
import { splitTasks, certifyAgainstHeldOut } from './held_out_oracle.js';
import type { FabricationResult } from './fabricate.js';

/** Como `Synthesizer` pero asíncrono: la síntesis (LLM+jaula) es async; la candidata, sync. */
export interface AsyncSynthesizer<I, O> {
  synthesize(trainExamples: readonly OracleTask<I, O>[]): Promise<(input: I) => O>;
}

/**
 * Versión async de `fabricate`: espera a la síntesis (LLM+jaula) y certifica la
 * candidata resuelta contra los casos ocultos. Mismas garantías que `fabricate`:
 * candidata devuelta SOLO si se certificó; sin adopción (human-gated). Si la síntesis
 * rechaza (código inseguro) o falla, la excepción se propaga — no se certifica lo que
 * no se pudo construir de forma segura.
 */
export async function fabricateAsync<I, O>(
  tasks: readonly OracleTask<I, O>[],
  synth: AsyncSynthesizer<I, O>,
  opts: { trainCount?: number } = {},
): Promise<FabricationResult<I, O>> {
  const trainCount = Math.max(1, opts.trainCount ?? Math.ceil(tasks.length / 2));
  const { train, heldOut } = splitTasks(tasks, trainCount);
  const candidate = await synth.synthesize(train);
  const certifyResult = certifyAgainstHeldOut(candidate, heldOut);
  return {
    certified: certifyResult.certified,
    certifyResult,
    candidate: certifyResult.certified ? candidate : undefined,
    trainCount: train.length,
    heldOutCount: heldOut.length,
  };
}
