// src/evaluation/prompt_quality.ts
//
// FASE 0 del encargo "Refinador de prompts" — Promptfoo como juez objetivo
// de calidad de prompt.
//
// `evaluatePromptQuality(A, B, cases)` puntúa el prompt A (original) y el
// prompt B (refinado) contra un set de casos reales usando Promptfoo y
// devuelve un veredicto objetivo: ¿B supera a A?
//
// Promptfoo es INFRAESTRUCTURA DE VALIDACIÓN, no una dependencia en caliente:
// se invoca solo desde golden sets / herramientas de evaluación, nunca en el
// camino de respuesta al usuario.
//
// Contrato de robustez (idéntico a la skill del Bloque 4): la función SIEMPRE
// responde, NUNCA lanza. Si Promptfoo falla (no instalado, timeout, error de
// proveedor) devuelve { winner:'tie', error:<motivo> } y deja decidir al
// llamador.

import promptfoo from 'promptfoo';

/** Una aserción Promptfoo (forma laxa — refleja el schema de Promptfoo). */
export interface EvalAssertion {
  type: string;
  value?: unknown;
  weight?: number;
  provider?: string;
  [k: string]: unknown;
}

/** Un caso de evaluación: variables de plantilla + aserciones a verificar. */
export interface EvalCase {
  /** Variables que rellenan `{{var}}` (o `{var}`) en los prompts. */
  vars: Record<string, string>;
  /** Aserciones que puntúan el output (deterministas o llm-rubric). */
  assert: EvalAssertion[];
}

export interface PromptQualityResult {
  /** 'B' = el refinado supera; 'A' = el original es mejor; 'tie' = empate. */
  winner: 'A' | 'B' | 'tie';
  /** Score normalizado [0,1] del prompt A. */
  scoreA: number;
  /** Score normalizado [0,1] del prompt B. */
  scoreB: number;
  /** Resumen legible del veredicto. */
  detail: string;
  /** Presente solo si Promptfoo no pudo evaluar — el veredicto es 'tie'. */
  error?: string;
}

export interface EvaluateOptions {
  /** Proveedor que ejecuta los prompts. Default: Haiku vía OpenRouter (§8). */
  provider?: string;
  /** Proveedor que puntúa las aserciones llm-rubric. Default: el mismo. */
  graderProvider?: string;
  /** Margen por debajo del cual la diferencia se considera empate. */
  tieMargin?: number;
}

// Modelo barato vía OpenRouter — el mismo backend que usa Shinobi. La
// evaluación de calidad NO necesita el modelo caro (§8 del manual).
const DEFAULT_PROVIDER = 'openrouter:anthropic/claude-haiku-4.5';
const DEFAULT_TIE_MARGIN = 0.05;

/**
 * Liga las variables del caso en el prompt: convierte `{var}` (una llave) a
 * `{{var}}` (sintaxis de plantilla de Promptfoo) para las claves conocidas,
 * sin tocar las que ya están en `{{var}}`. Así la función acepta prompts
 * escritos con cualquiera de las dos convenciones.
 */
function bindVars(prompt: string, varKeys: string[]): string {
  let p = prompt;
  for (const k of varKeys) {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    p = p.replace(new RegExp(`(?<!\\{)\\{\\s*${esc}\\s*\\}(?!\\})`, 'g'), `{{${k}}}`);
  }
  return p;
}

/** Score normalizado [0,1] de un CompletedPrompt de Promptfoo. */
function normalizedScore(metrics: any, numCases: number): number {
  if (!metrics || numCases <= 0) return 0;
  // `score` de Promptfoo = suma de los scores por caso (cada uno 0..1).
  const raw = typeof metrics.score === 'number' ? metrics.score : 0;
  return Math.max(0, Math.min(1, raw / numCases));
}

/**
 * Evalúa con Promptfoo si el prompt B (refinado) supera al prompt A
 * (original) contra `cases`. Siempre responde; nunca lanza.
 */
export async function evaluatePromptQuality(
  promptA: string,
  promptB: string,
  cases: EvalCase[],
  opts: EvaluateOptions = {},
): Promise<PromptQualityResult> {
  const fail = (error: string): PromptQualityResult =>
    ({ winner: 'tie', scoreA: 0, scoreB: 0, detail: `evaluación no concluyente: ${error}`, error });

  if (!promptA || !promptA.trim()) return fail('promptA vacío');
  if (!promptB || !promptB.trim()) return fail('promptB vacío');
  if (!Array.isArray(cases) || cases.length === 0) return fail('sin casos de evaluación');

  const provider = opts.provider ?? DEFAULT_PROVIDER;
  const graderProvider = opts.graderProvider ?? provider;
  const tieMargin = opts.tieMargin ?? DEFAULT_TIE_MARGIN;

  // Claves de variables presentes en los casos → para ligar {var} en prompts.
  const varKeys = [...new Set(cases.flatMap(c => Object.keys(c.vars ?? {})))];
  const boundA = bindVars(promptA, varKeys);
  const boundB = bindVars(promptB, varKeys);

  try {
    const summary: any = await promptfoo.evaluate(
      {
        // label estable → Promptfoo identifica cada prompt en las métricas.
        prompts: [
          { raw: boundA, label: 'A_original' },
          { raw: boundB, label: 'B_refinado' },
        ],
        // temperature 0 → la evaluación de calidad es lo más determinista
        // posible (el veredicto debe ser reproducible, no ruido del sampler).
        providers: [{ id: provider, config: { temperature: 0 } }],
        tests: cases.map(c => ({ vars: c.vars, assert: c.assert as any })),
        // El grader de las aserciones llm-rubric también va por OpenRouter
        // (si fuese el default OpenAI directo daría 401 en este entorno).
        defaultTest: { options: { provider: graderProvider } },
      } as any,
      { maxConcurrency: 4, cache: false } as any,
    );

    const prompts: any[] = Array.isArray(summary?.prompts) ? summary.prompts : [];
    if (prompts.length < 2) return fail('Promptfoo no devolvió métricas para ambos prompts');

    const mA = prompts.find(p => p.label === 'A_original') ?? prompts[0];
    const mB = prompts.find(p => p.label === 'B_refinado') ?? prompts[1];
    const scoreA = normalizedScore(mA?.metrics, cases.length);
    const scoreB = normalizedScore(mB?.metrics, cases.length);

    const diff = scoreB - scoreA;
    const winner: 'A' | 'B' | 'tie' =
      Math.abs(diff) < tieMargin ? 'tie' : diff > 0 ? 'B' : 'A';

    const detail =
      `A(original)=${scoreA.toFixed(3)} · B(refinado)=${scoreB.toFixed(3)} · ` +
      `Δ=${diff >= 0 ? '+' : ''}${diff.toFixed(3)} → ganador: ${winner} ` +
      `(${cases.length} casos, margen empate ${tieMargin}).`;

    return { winner, scoreA, scoreB, detail };
  } catch (e: any) {
    return fail(e?.message ?? String(e));
  }
}
