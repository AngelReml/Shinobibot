// src/agents/best_of_n.ts
//
// MOTOR E5 — TEST-TIME COMPUTE (best-of-N con reranking por verificación).
//
// Genera N candidatos DIVERSOS para la misma tarea (variando temperatura) y deja
// que el reranker — el verificador adversarial (E1) + la compuerta objetiva
// (tests/typecheck) — elija el mejor por una política de orden TOTAL y
// DETERMINISTA (best_of_n_select). Es la capacidad que sube pass@1 en benchmarks
// públicos sin cambiar de modelo: el mismo Claude/GPT, mejor scaffolding.
//
// Compone piezas que YA existen: runAgentLoop (productor puro, inyectable),
// verifyResult (juez adversarial) y runObjectiveChecks (gate duro de código).
// El LLM del productor y el del juez son inyectables por separado (juez más
// escéptico/barato, y test determinista sin red).
//
// Relación con runVerifiedAgent (E1): E1 es SECUENCIAL (verifica→reintenta con
// feedback). best-of-N es PARALELO (genera variedad→selecciona). Se complementan:
// E1 corrige un hilo; best-of-N cubre el espacio. runBestOfN puede usar E1 como
// productor de cada candidato (verifiedProducer=true) para lo mejor de ambos.

import { runAgentLoop, type AgentLoopOptions, type AgentLoopResult, type LLMInvoker } from './agent_loop.js';
import { runVerifiedAgent } from './verified_agent.js';
import { verifyResult, type Verdict } from './verifier.js';
import { selectBest, type ScoredCandidate, type Selection } from './best_of_n_select.js';

export { selectBest, rankKey } from './best_of_n_select.js';
export type { ScoredCandidate, Selection } from './best_of_n_select.js';

export interface BestOfNOptions extends AgentLoopOptions {
  /** Nº de candidatos a generar (default 3). */
  n?: number;
  /** Criterios de aceptación que exigirá el verificador. */
  criteria?: string;
  /**
   * Temperaturas por rollout para diversificar. Si se omite, se reparte un
   * abanico determinista en [0.2, 1.0]. Se reciclan si hay menos que N.
   */
  temperatures?: number[];
  /** Compuerta OBJETIVA (gate duro): si la pasa, el candidato sube de tier. */
  objectiveCheck?: (output: string) => Promise<{ passed: boolean; issues: string[] }>;
  /** LLM del verificador (default: el del productor). */
  verifyInvokeLLM?: LLMInvoker;
  /** Modelo del verificador (default: el del productor). */
  verifyModel?: string;
  /** Caja READ-ONLY del verificador (default []). */
  verifyTools?: string[];
  /** Candidatos concurrentes (default = n; 1 fuerza secuencial/determinista). */
  concurrency?: number;
  /**
   * Si true, cada candidato se produce con runVerifiedAgent (E1) en vez de un
   * agent_loop crudo: cada hilo ya se auto-corrige antes de competir. Default false.
   */
  verifiedProducer?: boolean;
  /** Intentos internos de E1 cuando verifiedProducer=true (default 2). */
  producerAttempts?: number;
}

export interface BestOfNResult {
  /** true si el candidato elegido cerró Y el verificador (o el gate objetivo) lo aprobó. */
  ok: boolean;
  /** Salida del candidato elegido. */
  output: string;
  /** Detalle de la selección (ranking + justificación). */
  selection: Selection;
  /** Todos los candidatos puntuados (para auditoría/telemetría). */
  candidates: ScoredCandidate[];
  /** Nº de candidatos efectivamente generados. */
  attempts: number;
  /** Veredicto del verificador sobre el candidato elegido. */
  verdict: Verdict;
}

/** Abanico determinista de temperaturas en [0.2, 1.0] para N rollouts. */
export function defaultTemperatures(n: number): number[] {
  const count = Math.max(1, n);
  if (count === 1) return [0.2];
  const lo = 0.2, hi = 1.0;
  return Array.from({ length: count }, (_, i) => {
    const t = lo + ((hi - lo) * i) / (count - 1);
    return Math.round(t * 100) / 100;
  });
}

async function boundedPool<T>(items: T[], limit: number, worker: (it: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  const width = Math.max(1, Math.min(limit, items.length || 1));
  const runners = Array.from({ length: width }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

const EMPTY_VERDICT: Verdict = { passed: false, score: 0, issues: [], rationale: '' };

/**
 * Ejecuta best-of-N y devuelve el mejor candidato según el reranker. Nunca
 * inventa éxito: si ninguno pasa, devuelve el mejor relativo con ok=false.
 */
export async function runBestOfN(opts: BestOfNOptions): Promise<BestOfNResult> {
  const n = Math.max(1, opts.n ?? 3);
  const temps = (opts.temperatures && opts.temperatures.length > 0)
    ? opts.temperatures
    : defaultTemperatures(n);

  const scored: ScoredCandidate[] = new Array(n);
  const verdicts: Verdict[] = new Array(n);

  await boundedPool(Array.from({ length: n }, (_, i) => i), opts.concurrency ?? n, async (i) => {
    const temperature = temps[i % temps.length];

    // 1) Producir el candidato (crudo o ya auto-corregido por E1).
    let output = '';
    let ok = false;
    let iterations = 0;
    if (opts.verifiedProducer) {
      const vr = await runVerifiedAgent({
        ...opts,
        temperature,
        maxAttempts: opts.producerAttempts ?? 2,
        criteria: opts.criteria,
        objectiveCheck: opts.objectiveCheck,
        verifyInvokeLLM: opts.verifyInvokeLLM,
        verifyModel: opts.verifyModel,
        verifyTools: opts.verifyTools,
      });
      output = vr.output; ok = vr.ok;
      iterations = vr.history[vr.history.length - 1]?.result.iterations ?? 0;
    } else {
      const r: AgentLoopResult = await runAgentLoop({ ...opts, temperature });
      output = r.output; ok = r.ok; iterations = r.iterations ?? 0;
    }

    // 2) Compuerta OBJETIVA (gate duro de código), si se aportó.
    let objectivePassed: boolean | undefined;
    if (opts.objectiveCheck) {
      try {
        objectivePassed = (await opts.objectiveCheck(output)).passed;
      } catch {
        objectivePassed = false;
      }
    }

    // 3) Verificador adversarial (reranker continuo). Si el rollout no cerró,
    //    no se gasta el juez: cuenta como no-aprobado.
    let verdict: Verdict = EMPTY_VERDICT;
    if (ok) {
      verdict = await verifyResult({
        goal: opts.task,
        result: output,
        criteria: opts.criteria,
        tools: opts.verifyTools ?? [],
        label: `${opts.label ?? 'bestofn'}:verify#${i}`,
        model: opts.verifyModel ?? opts.model,
        invokeLLM: opts.verifyInvokeLLM ?? opts.invokeLLM,
      });
    }
    verdicts[i] = verdict;
    scored[i] = {
      index: i,
      output,
      ok,
      objectivePassed,
      verifierPassed: verdict.passed,
      score: verdict.score,
      iterations,
    };
  });

  const selection = selectBest(scored);
  const chosenVerdict = verdicts[selection.chosenIndex] ?? EMPTY_VERDICT;
  const chosen = selection.chosen;
  // ok del conjunto = el elegido cerró y (pasó el gate objetivo si lo hubo) y el verificador aprobó.
  const objOk = chosen.objectivePassed !== false; // true o no-aplicado
  const ok = chosen.ok && objOk && chosen.verifierPassed;

  return {
    ok,
    output: selection.chosen.output,
    selection,
    candidates: scored,
    attempts: n,
    verdict: chosenVerdict,
  };
}
