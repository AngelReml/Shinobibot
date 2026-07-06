// P5 (Kangeiko) — el oráculo de casos OCULTOS (held-out).
//
// El corazón de "¿cómo sabe el bot, él solo, que la herramienta que fabricó SIRVE?".
// Regla de oro: se fabrica con UNOS ejemplos (train, visibles) y se CERTIFICA con
// OTROS distintos (held-out, ocultos al fabricar). Un candidato que hace trampa
// memorizando las respuestas de train FALLA en held-out → no se certifica. Es la
// defensa DETERMINISTA contra el "reward hacking" (hacer trampa al examen), medido en
// >30% de casos con modelos frontera.
//
// PURO y determinista: sin LLM en el veredicto. El `candidate` que recibe es una
// función YA materializada; en producción viene de ejecutar el código fabricado dentro
// de la jaula (isolated-vm, P3); en test, un closure. Esta capa NO ejecuta código
// foráneo — solo aplica una función a entradas y compara salidas.

/** Un caso del oráculo: una entrada y su salida esperada (verificable). */
export interface OracleTask<I = unknown, O = unknown> {
  readonly input: I;
  readonly expected: O;
}

/** Igualdad estructural por defecto (JSON canónico). Inyectable para casos especiales. */
export function structuralEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Reparte los casos en `train` (visibles al fabricar) y `heldOut` (ocultos — la prueba
 * real). Determinista: los primeros `trainCount` a train, el resto a held-out.
 */
export function splitTasks<I, O>(
  tasks: readonly OracleTask<I, O>[],
  trainCount: number,
): { train: OracleTask<I, O>[]; heldOut: OracleTask<I, O>[] } {
  const t = Math.max(0, Math.min(Math.floor(trainCount), tasks.length));
  return { train: tasks.slice(0, t), heldOut: tasks.slice(t) };
}

export interface CertifyResult {
  readonly certified: boolean;
  readonly heldOutPassed: number;
  readonly heldOutTotal: number;
  /** Presente si NO se certificó por una salida distinta. */
  readonly firstFailure?: { readonly input: unknown; readonly expected: unknown; readonly got: unknown };
  /** Presente si el candidato LANZÓ en algún caso (código roto). */
  readonly threw?: { readonly input: unknown; readonly error: string };
}

/**
 * Certifica un candidato SOLO si pasa TODOS los casos OCULTOS. Fail-closed:
 *   - held-out vacío ⇒ NO se certifica (sin prueba oculta no hay garantía).
 *   - el candidato lanza ⇒ NO se certifica (código roto).
 *   - una sola salida distinta ⇒ NO se certifica.
 * Determinista, sin LLM. `eq` inyectable (default: igualdad estructural).
 */
export function certifyAgainstHeldOut<I, O>(
  candidate: (input: I) => O,
  heldOut: readonly OracleTask<I, O>[],
  eq: (a: unknown, b: unknown) => boolean = structuralEqual,
): CertifyResult {
  if (heldOut.length === 0) {
    return { certified: false, heldOutPassed: 0, heldOutTotal: 0 };
  }
  let passed = 0;
  for (const task of heldOut) {
    let got: O;
    try {
      got = candidate(task.input);
    } catch (e) {
      return {
        certified: false, heldOutPassed: passed, heldOutTotal: heldOut.length,
        threw: { input: task.input, error: (e as Error)?.message ?? String(e) },
      };
    }
    if (!eq(got, task.expected)) {
      return {
        certified: false, heldOutPassed: passed, heldOutTotal: heldOut.length,
        firstFailure: { input: task.input, expected: task.expected, got },
      };
    }
    passed++;
  }
  return { certified: true, heldOutPassed: passed, heldOutTotal: heldOut.length };
}
