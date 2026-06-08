// src/agents/verified_agent.ts
//
// Motor E1 — el BUCLE DE CORRECCIÓN CERRADO.
//
// runVerifiedAgent = ejecutar un agent_loop, VERIFICAR su salida con un revisor
// adversarial, y si no pasa, REINTENTAR alimentando los defectos como feedback,
// todo acotado. Es lo que convierte "la excelencia es el mínimo" en una
// propiedad mecánica del sistema: el agente no entrega hasta que un revisor
// independiente confirma que cumple — o se agotan los intentos y se reporta el
// fallo con honestidad (nunca se disfraza de éxito).
//
// Compone agent_loop (productor) + verifier (juez). Ambos LLM son inyectables
// por separado para test determinista y para poder usar modelos distintos
// (p. ej. un juez más barato/escéptico).

import { runAgentLoop, type AgentLoopOptions, type AgentLoopResult, type LLMInvoker } from './agent_loop.js';
import { verifyResult, type Verdict } from './verifier.js';

export interface VerifiedAgentOptions extends AgentLoopOptions {
  /** Criterios de aceptación que el verificador exigirá. */
  criteria?: string;
  /**
   * Pre-gate OBJETIVO (E1): comprobación de código (tests/typecheck/lint) sobre
   * la salida del productor. Gate DURO — si no pasa, NO se aprueba pase lo que
   * diga el verificador LLM, y sus issues se reinyectan. Suele construirse con
   * runObjectiveChecks() del objective_verifier.
   */
  objectiveCheck?: (output: string) => Promise<{ passed: boolean; issues: string[] }>;
  /** Nº máximo de intentos productor→verificador (default 2). */
  maxAttempts?: number;
  /** Caja READ-ONLY del verificador (default []). */
  verifyTools?: string[];
  /** LLM del verificador (default: el mismo invokeLLM del productor). */
  verifyInvokeLLM?: LLMInvoker;
  /** Modelo del verificador (default: el del productor). */
  verifyModel?: string;
}

export interface VerifiedAttempt {
  result: AgentLoopResult;
  verdict: Verdict;
}

export interface VerifiedAgentResult {
  /** true si una de las pasadas produjo un resultado que el verificador aprobó. */
  ok: boolean;
  /** La salida aprobada (o la última si ninguna pasó). */
  output: string;
  /** Veredicto de la última pasada. */
  verdict: Verdict;
  /** Nº de pasadas realizadas. */
  attempts: number;
  /** Histórico productor+veredicto de cada pasada (para auditoría). */
  history: VerifiedAttempt[];
}

/** Compone el feedback de defectos de la pasada anterior para reinyectarlo. */
function feedbackContext(verdict: Verdict): string {
  const issues = verdict.issues.length > 0
    ? verdict.issues.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '(sin defectos enumerados)';
  return (
    'REVISIÓN DEL INTENTO ANTERIOR — tu resultado NO fue aprobado.\n' +
    `Puntuación: ${verdict.score.toFixed(2)}. ${verdict.rationale}\n` +
    'Defectos que DEBES corregir en este intento:\n' +
    issues
  );
}

/**
 * Ejecuta el bucle de corrección cerrado. Devuelve la primera salida aprobada,
 * o (si se agotan los intentos) la última con su veredicto — `ok=false` con
 * honestidad, nunca un falso éxito.
 */
export async function runVerifiedAgent(options: VerifiedAgentOptions): Promise<VerifiedAgentResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
  const goal = options.task;
  const criteria = options.criteria;
  const history: VerifiedAttempt[] = [];

  let lastVerdict: Verdict = { passed: false, score: 0, issues: [], rationale: '' };
  let lastOutput = '';
  let priorFeedback: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // El contexto base del productor más, en reintentos, los defectos previos.
    const context = [options.context, priorFeedback].filter(Boolean).join('\n\n') || undefined;
    const result = await runAgentLoop({ ...options, context });

    if (!result.ok) {
      // El productor ni cerró (error / bucle): cuenta como no-pasa con el motivo
      // como defecto, y se reintenta con ese feedback.
      lastVerdict = {
        passed: false,
        score: 0,
        issues: [`El agente no cerró su tarea (${result.verdict}): ${result.error ?? ''}`.trim()],
        rationale: '',
      };
      lastOutput = result.output;
      history.push({ result, verdict: lastVerdict });
      priorFeedback = feedbackContext(lastVerdict);
      continue;
    }

    // Pre-gate OBJETIVO: si falla, no se aprueba (el LLM no puede revocarlo).
    if (options.objectiveCheck) {
      let oc: { passed: boolean; issues: string[] };
      try {
        oc = await options.objectiveCheck(result.output);
      } catch (e: any) {
        oc = { passed: false, issues: [`el control objetivo lanzó: ${e?.message ?? e}`] };
      }
      if (!oc.passed) {
        lastVerdict = { passed: false, score: 0, issues: oc.issues, rationale: 'controles objetivos (tests/typecheck) fallaron' };
        lastOutput = result.output;
        history.push({ result, verdict: lastVerdict });
        priorFeedback = feedbackContext(lastVerdict);
        continue;
      }
    }

    const verdict = await verifyResult({
      goal,
      result: result.output,
      criteria,
      tools: options.verifyTools ?? [],
      label: `${options.label ?? 'agent'}:verify`,
      model: options.verifyModel ?? options.model,
      invokeLLM: options.verifyInvokeLLM ?? options.invokeLLM,
    });

    lastVerdict = verdict;
    lastOutput = result.output;
    history.push({ result, verdict });

    if (verdict.passed) {
      return { ok: true, output: result.output, verdict, attempts: attempt, history };
    }
    priorFeedback = feedbackContext(verdict);
  }

  return { ok: false, output: lastOutput, verdict: lastVerdict, attempts: history.length, history };
}
