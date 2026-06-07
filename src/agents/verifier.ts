// src/agents/verifier.ts
//
// Motor E1 — compuerta de AUTO-VERIFICACIÓN.
//
// Un verificador es, por diseño, un agent_loop con una caja READ-ONLY (o vacía)
// y un prompt adversarial: su trabajo es REFUTAR que el resultado cumple el
// objetivo, no aplaudirlo. Devuelve un veredicto ESTRUCTURADO.
//
// Principio rector del proyecto: "la excelencia es el mínimo esperado". Aquí se
// vuelve mecánico: una salida que no pasa la verificación no se acepta. Y el
// fail-safe es conservador — si el veredicto no se puede parsear o el verificador
// falla, NO se da por bueno (passed=false). Mejor un falso negativo (reintentar)
// que un falso positivo (entregar basura como excelencia).

import { runAgentLoop, type LLMInvoker } from './agent_loop.js';

export interface Verdict {
  /** true solo si el verificador confirma que el resultado cumple el objetivo. */
  passed: boolean;
  /** Confianza/calidad 0..1. */
  score: number;
  /** Defectos concretos hallados (vacío si passed). */
  issues: string[];
  /** Justificación breve del veredicto. */
  rationale: string;
}

export interface VerifyOptions {
  /** Objetivo original que el resultado debía cumplir. */
  goal: string;
  /** El resultado producido, a enjuiciar. */
  result: string;
  /** Criterios de aceptación explícitos (opcional). */
  criteria?: string;
  /**
   * Caja READ-ONLY para que el verificador compruebe evidencia (p. ej.
   * read_file, list_dir). Default vacía (juicio puro sobre el texto).
   */
  tools?: string[];
  model?: string;
  /** Etiqueta para correlación en el audit. */
  label?: string;
  /** LLM inyectable (test). Por defecto el provider router. */
  invokeLLM?: LLMInvoker;
  /** Tope de iteraciones del verificador (default 4). */
  maxIterations?: number;
}

const REVIEWER_SYSTEM =
  'Eres un REVISOR ADVERSARIAL y escéptico. Tu trabajo NO es aprobar: es ' +
  'encontrar por qué el RESULTADO podría NO cumplir el OBJETIVO. Sé estricto: ' +
  'la excelencia es el mínimo aceptable. Si tienes herramientas de lectura, ' +
  'úsalas para comprobar la evidencia antes de juzgar.\n\n' +
  'Cuando termines, responde EXCLUSIVAMENTE con un objeto JSON válido, sin texto ' +
  'alrededor, con esta forma:\n' +
  '{"passed": boolean, "score": number entre 0 y 1, "issues": [string, ...], "rationale": string}\n' +
  'passed=true SOLO si el resultado cumple el objetivo sin defectos relevantes. ' +
  'Si dudas, passed=false y enumera los defectos en issues.';

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Extrae un Verdict de la respuesta libre del verificador. Tolerante: prueba
 * parseo completo y, si falla, busca el primer bloque {...}. Fail-safe: si no
 * se puede parsear, passed=false.
 *
 * Exportada para test.
 */
export function extractVerdict(text: string): Verdict {
  const tryParse = (s: string): any | null => {
    try { return JSON.parse(s); } catch { return null; }
  };
  const raw = (text ?? '').trim();
  let obj = tryParse(raw);
  if (!obj) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) obj = tryParse(m[0]);
  }
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const passed = obj.passed === true;
    return {
      passed,
      score: typeof obj.score === 'number' ? clamp01(obj.score) : (passed ? 1 : 0),
      issues: Array.isArray(obj.issues) ? obj.issues.map((x: unknown) => String(x)).filter(Boolean) : [],
      rationale: typeof obj.rationale === 'string' ? obj.rationale : '',
    };
  }
  // Fail-safe conservador: sin veredicto parseable, NO se aprueba.
  return {
    passed: false,
    score: 0,
    issues: ['El verificador no devolvió un veredicto parseable.'],
    rationale: raw.slice(0, 300),
  };
}

/** Ejecuta el verificador adversarial y devuelve su veredicto estructurado. */
export async function verifyResult(opts: VerifyOptions): Promise<Verdict> {
  const criteriaBlock = opts.criteria ? `\n\nCRITERIOS DE ACEPTACIÓN:\n${opts.criteria}` : '';
  const task =
    `OBJETIVO:\n${opts.goal}\n\n` +
    `RESULTADO A VERIFICAR:\n${opts.result}${criteriaBlock}\n\n` +
    `¿El resultado cumple el objetivo? Responde con el JSON del veredicto.`;

  const res = await runAgentLoop({
    task,
    systemPrompt: REVIEWER_SYSTEM,
    tools: opts.tools ?? [],
    label: opts.label ?? 'verifier',
    model: opts.model,
    temperature: 0,
    maxIterations: opts.maxIterations ?? 4,
    invokeLLM: opts.invokeLLM,
  });

  if (!res.ok) {
    // El propio verificador no pudo cerrar (error / bucle): fail-safe.
    return {
      passed: false,
      score: 0,
      issues: [`El verificador no pudo emitir veredicto (${res.verdict}): ${res.error ?? ''}`.trim()],
      rationale: '',
    };
  }
  return extractVerdict(res.output);
}
