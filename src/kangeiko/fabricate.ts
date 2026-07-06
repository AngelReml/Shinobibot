// P5 (Kangeiko) — el bucle de FABRICACIÓN de transformaciones puras.
//
// Cierra el lazo "fabrica → certifica" sobre el oráculo de casos ocultos: se fabrica
// con los ejemplos de TRAIN (visibles) y se certifica SOLO con los HELD-OUT (ocultos).
// NO adopta nada — la adopción de una herramienta certificada es human-gated (fuera de
// aquí). Puro dado un sintetizador puro.
//
// El SINTETIZADOR es pluggable (inversión de dependencia): esta capa no sabe CÓMO se
// produce la candidata, solo la certifica. El modo test usa un sintetizador FAKE
// determinista (devuelve una función JS ya materializada). El modo real —LLM que emite
// CÓDIGO ejecutado dentro de la jaula (isolated-vm, P3)— es un adaptador aparte
// (nativo/Windows) que implementa esta MISMA interfaz `Synthesizer`. Así el bucle se
// prueba entero SIN ejecutar código foráneo en este entorno, y el vector peligroso
// (correr código generado) queda contenido en el adaptador jaulado.

import type { OracleTask, CertifyResult } from './held_out_oracle.js';
import { splitTasks, certifyAgainstHeldOut } from './held_out_oracle.js';

/** Propone una función candidata a partir de los ejemplos de TRAIN. */
export interface Synthesizer<I, O> {
  synthesize(trainExamples: readonly OracleTask<I, O>[]): (input: I) => O;
}

export interface FabricationResult<I, O> {
  readonly certified: boolean;
  readonly certifyResult: CertifyResult;
  /** La candidata SOLO si se certificó (para una adopción posterior, human-gated). */
  readonly candidate?: (input: I) => O;
  readonly trainCount: number;
  readonly heldOutCount: number;
}

/**
 * Fabrica una transformación y la certifica contra casos ocultos. Reparte los `tasks`
 * en train (primeros `trainCount`, por defecto la mitad, ≥1) y held-out (el resto).
 * Fabrica con train, certifica con held-out. Devuelve la candidata SOLO si se certificó.
 * Fail-closed: si el sintetizador lanza, se propaga (no se certifica una candidata que
 * ni siquiera se pudo construir). Puro dado un sintetizador puro; sin adopción.
 */
export function fabricate<I, O>(
  tasks: readonly OracleTask<I, O>[],
  synth: Synthesizer<I, O>,
  opts: { trainCount?: number } = {},
): FabricationResult<I, O> {
  const trainCount = Math.max(1, opts.trainCount ?? Math.ceil(tasks.length / 2));
  const { train, heldOut } = splitTasks(tasks, trainCount);
  const candidate = synth.synthesize(train);
  const certifyResult = certifyAgainstHeldOut(candidate, heldOut);
  return {
    certified: certifyResult.certified,
    certifyResult,
    candidate: certifyResult.certified ? candidate : undefined,
    trainCount: train.length,
    heldOutCount: heldOut.length,
  };
}
