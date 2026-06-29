// src/dispatch/shadow_recorder.ts
//
// Registro SHADOW del clasificador de despacho (Bloque 3).
//
// El clasificador corre EN PARALELO al despacho actual sin controlarlo:
// registra qué HABRÍA decidido. Cada entrada se anexa a shadow_dispatch.jsonl
// (raíz del repo) — ese fichero es la comparación shadow vs despacho actual
// que Iván lee antes de decidir la promoción (parada (a) del encargo).
//
// Opt-in: solo se activa con SHINOBI_SHADOW_DISPATCH=1, como el resto de
// subsistemas de Shinobi (background_review, memory_reflector, model_router).

import * as fs from 'fs';
import * as path from 'path';
import { classifyDispatch } from './classifier.js';
import type { DispatchDecision, DispatchMode, ShadowEntry } from './types.js';

/** Ruta del registro shadow — raíz del repo, fácil de encontrar para Iván. */
export function shadowLogPath(): string {
  return path.join(process.cwd(), 'shadow_dispatch.jsonl');
}

/** ¿Está el shadow mode activado? Opt-in estricto. */
export function shadowDispatchEnabled(): boolean {
  return process.env.SHINOBI_SHADOW_DISPATCH === '1';
}

/**
 * Modo activo del clasificador: 'shadow' (default) o 'active'.
 * Solo 'active' si SHINOBI_DISPATCH_MODE=active Y el clasificador ya fue
 * evaluado como elegible para promoción.
 */
export function dispatchMode(): DispatchMode {
  return process.env.SHINOBI_DISPATCH_MODE === 'active' ? 'active' : 'shadow';
}

/** ¿El clasificador controla el despacho real? */
export function dispatchClassifierActive(): boolean {
  return dispatchMode() === 'active';
}

/** Anexa una entrada al registro shadow (escritura append, una línea JSON). */
export function recordShadowDecision(message: string, decision: DispatchDecision): ShadowEntry {
  const entry: ShadowEntry = {
    ts: new Date().toISOString(),
    message: message.length > 300 ? message.slice(0, 300) + '…' : message,
    shadow: decision,
    currentDispatch: 'general-orchestrator',
  };
  fs.appendFileSync(shadowLogPath(), JSON.stringify(entry) + '\n', 'utf-8');
  return entry;
}

/**
 * Clasifica una orden y registra la decisión shadow. Best-effort: nunca
 * lanza — un fallo aquí jamás puede afectar al despacho real. El orchestrator
 * la invoca fire-and-forget.
 */
export async function shadowClassifyAndRecord(message: string): Promise<ShadowEntry | null> {
  try {
    const decision = await classifyDispatch(message);
    return recordShadowDecision(message, decision);
  } catch (e: any) {
    console.log(`[shadow_dispatch] clasificación shadow falló (sin efecto en el despacho real): ${e?.message ?? e}`);
    return null;
  }
}

/**
 * Registra el resultado de una misión sobre una entrada shadow previa.
 * El orchestrator llama a esto al finalizar una misión.
 */
export function recordShadowOutcome(entryTs: string, outcome: 'success' | 'failure', iterations: number): void {
  const p = shadowLogPath();
  if (!fs.existsSync(p)) return;
  const lines = fs.readFileSync(p, 'utf-8').split('\n');
  const updated = lines.map(l => {
    if (!l.trim()) return l;
    try {
      const e = JSON.parse(l) as ShadowEntry;
      if (e.ts === entryTs) return JSON.stringify({ ...e, outcome, iterations });
      return l;
    } catch { return l; }
  });
  fs.writeFileSync(p, updated.join('\n'), 'utf-8');
}

/**
 * Evalúa si el clasificador es elegible para promoción a modo activo.
 *
 * Criterios:
 * - Al menos `minMissions` entradas con outcome registrado.
 * - Al menos `minSuccessRate`% de las misiones donde el shadow dijo 'general'
 *   terminaron en success (el clasificador sabe cuándo NO especializar).
 *
 * La idea: si el clasificador distingue bien cuándo enviar a general vs
 * especialista, y las misiones que envió a general terminaron bien, es
 * una señal positiva para promoción.
 */
export interface PromotionEvaluation {
  eligible: boolean;
  totalWithOutcome: number;
  generalDecisions: number;
  generalSuccessRate: number;
  reason: string;
}

export function evaluatePromotion(minMissions = 20, minSuccessRate = 0.8): PromotionEvaluation {
  const entries = readShadowLog();
  const withOutcome = entries.filter(e => e.outcome !== undefined);
  if (withOutcome.length < minMissions) {
    return {
      eligible: false,
      totalWithOutcome: withOutcome.length,
      generalDecisions: 0,
      generalSuccessRate: 0,
      reason: `Insuficientes datos: ${withOutcome.length}/${minMissions} misiones con outcome registrado`,
    };
  }
  const generalDecisions = withOutcome.filter(e => e.shadow.specialist === 'general');
  const generalSuccess = generalDecisions.filter(e => e.outcome === 'success').length;
  const rate = generalDecisions.length > 0 ? generalSuccess / generalDecisions.length : 0;
  const eligible = rate >= minSuccessRate;
  return {
    eligible,
    totalWithOutcome: withOutcome.length,
    generalDecisions: generalDecisions.length,
    generalSuccessRate: rate,
    reason: eligible
      ? `Elegible: tasa de acierto en despacho general ${(rate * 100).toFixed(1)}% ≥ ${(minSuccessRate * 100).toFixed(1)}%`
      : `No elegible: tasa ${(rate * 100).toFixed(1)}% < ${(minSuccessRate * 100).toFixed(1)}%`,
  };
}

/** Lee el registro shadow completo (para informes / inspección). */
export function readShadowLog(): ShadowEntry[] {
  const p = shadowLogPath();
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l) as ShadowEntry; } catch { return null; } })
    .filter((e): e is ShadowEntry => e !== null);
}

/**
 * Resumen legible de la comparación shadow vs despacho actual. El despacho
 * actual es siempre 'general-orchestrator'; el resumen cuenta cuántas
 * órdenes el shadow habría enrutado a cada especialista — la señal que Iván
 * usa para decidir la promoción.
 */
export function summarizeShadowLog(): string {
  const entries = readShadowLog();
  if (entries.length === 0) return 'Registro shadow vacío (aún no hay decisiones).';
  const tally: Record<string, number> = { research_agent: 0, docs_agent: 0, data_agent: 0, general: 0 };
  let wouldReroute = 0;
  for (const e of entries) {
    tally[e.shadow.specialist] = (tally[e.shadow.specialist] ?? 0) + 1;
    if (e.shadow.specialist !== 'general') wouldReroute++;
  }
  return [
    `Registro shadow: ${entries.length} órdenes clasificadas.`,
    `Despacho actual: 100% general-orchestrator (no hay router).`,
    `El clasificador shadow habría enrutado:`,
    `  research_agent : ${tally.research_agent}`,
    `  docs_agent     : ${tally.docs_agent}`,
    `  data_agent     : ${tally.data_agent}`,
    `  general        : ${tally.general}`,
    `Divergencia (shadow enruta a especialista, actual fue general): ${wouldReroute}/${entries.length}.`,
  ].join('\n');
}
