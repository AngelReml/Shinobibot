// src/refiner/refiner_shadow.ts
//
// Registro SHADOW del refinador en camino caliente (FASE 1).
//
// El refinador se añade EN PARALELO al camino actual: registra qué HABRÍA
// hecho (nivel, si reescribe, modelo, si escala, prompt original vs
// refinado) en refiner_shadow.jsonl SIN controlar lo que recibe el
// subordinado. Misma disciplina que el clasificador del Bloque 3.
//
// Opt-in: solo se activa con SHINOBI_REFINER_SHADOW=1.
//
// La promoción de shadow a camino real es la PARADA R del encargo — no se
// cruza de forma autónoma.

import * as fs from 'fs';
import * as path from 'path';
import { classifyDispatch } from '../dispatch/classifier.js';
import { refineTask, type RefineResult, HOT_MODEL, ESCALATION_MODEL } from './hot_refiner.js';

export interface RefinerShadowEntry {
  ts: string;
  /** Tarea del usuario (truncada). */
  task: string;
  /** Especialista al que la enrutaría el clasificador de despacho. */
  specialist: string;
  level: string;
  confidence: string;
  rewritten: boolean;
  modelUsed: string;
  escalated: boolean;
  levelRationale: string;
  refinedTask: string;
  /**
   * Lo que hace el camino ACTUAL: ningún refinador — la tarea llega al
   * subordinado intacta. La comparación que Iván lee es: ¿qué habría
   * cambiado el refinador?
   */
  currentBehavior: 'passthrough-sin-refinador';
}

/** Ruta del registro shadow del refinador — raíz del repo. */
export function refinerShadowLogPath(): string {
  return path.join(process.cwd(), 'refiner_shadow.jsonl');
}

/** ¿Está el shadow mode del refinador activado? Opt-in estricto. */
export function refinerShadowEnabled(): boolean {
  return process.env.SHINOBI_REFINER_SHADOW === '1';
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** Anexa una entrada al registro shadow del refinador. */
export function recordRefinerDecision(task: string, specialist: string, r: RefineResult): RefinerShadowEntry {
  const entry: RefinerShadowEntry = {
    ts: new Date().toISOString(),
    task: truncate(task, 300),
    specialist,
    level: r.level,
    confidence: r.confidence,
    rewritten: r.rewritten,
    modelUsed: r.modelUsed,
    escalated: r.escalated,
    levelRationale: r.levelRationale,
    refinedTask: truncate(r.refinedTask, 600),
    currentBehavior: 'passthrough-sin-refinador',
  };
  fs.appendFileSync(refinerShadowLogPath(), JSON.stringify(entry) + '\n', 'utf-8');
  return entry;
}

/**
 * Para una tarea del usuario: decide si iría a un especialista y, si es así,
 * corre el refinador en shadow y registra la decisión. Best-effort: nunca
 * lanza — un fallo aquí jamás afecta al despacho real.
 *
 * Devuelve la entrada registrada, o null si la tarea no va a un especialista
 * (la maneja el orchestrator general → el refinador no aplica).
 */
export async function refineShadowForTask(task: string): Promise<RefinerShadowEntry | null> {
  try {
    const t = (task || '').trim();
    if (!t) return null;
    const dispatch = await classifyDispatch(t);
    // El refinador solo se interpone ante tareas que irían a un especialista.
    if (dispatch.specialist === 'general') return null;
    const refined = await refineTask(t);
    return recordRefinerDecision(t, dispatch.specialist, refined);
  } catch (e: any) {
    console.log(`[refiner_shadow] fallo shadow (sin efecto en el despacho real): ${e?.message ?? e}`);
    return null;
  }
}

/** Lee el registro shadow completo del refinador. */
export function readRefinerShadowLog(): RefinerShadowEntry[] {
  const p = refinerShadowLogPath();
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf-8')
    .split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => { try { return JSON.parse(l) as RefinerShadowEntry; } catch { return null; } })
    .filter((e): e is RefinerShadowEntry => e !== null);
}

// Coste relativo aproximado por llamada (unidades; rate documentado). Haiku
// es el barato del camino caliente; Sonnet solo entra en refinados escalados.
const COST_PER_CALL_USD: Record<string, number> = {
  [HOT_MODEL]: 0.0006,        // ~clasificación + refinado corto con Haiku
  [ESCALATION_MODEL]: 0.006,  // ~refinado escalado con Sonnet (≈10× Haiku)
};

export interface RefinerShadowSummary {
  total: number;
  rewritten: number;
  byLevel: Record<string, number>;
  escalated: number;
  haikuRefines: number;
  sonnetRefines: number;
  estCostUsd: number;
  text: string;
}

/**
 * Resume el registro shadow: cuántas tareas, cuántas se refinarían, la
 * distribución de niveles, cuántas escalarían al modelo caro y el coste
 * estimado. Es la señal que Iván lee para decidir la parada R.
 */
export function summarizeRefinerShadow(): RefinerShadowSummary {
  const entries = readRefinerShadowLog();
  const byLevel: Record<string, number> = { L1: 0, L2: 0, L3: 0 };
  let rewritten = 0, escalated = 0, haikuRefines = 0, sonnetRefines = 0;
  // Cada tarea = 1 clasificación de nivel (Haiku) + (si se reescribió) 1 refinado.
  let estCostUsd = 0;
  for (const e of entries) {
    byLevel[e.level] = (byLevel[e.level] ?? 0) + 1;
    estCostUsd += COST_PER_CALL_USD[HOT_MODEL]; // clasificación de nivel (siempre Haiku)
    if (e.rewritten) {
      rewritten++;
      if (e.escalated) { sonnetRefines++; estCostUsd += COST_PER_CALL_USD[ESCALATION_MODEL]; }
      else { haikuRefines++; estCostUsd += COST_PER_CALL_USD[HOT_MODEL]; }
    }
    if (e.escalated) escalated++;
  }
  const total = entries.length;
  const text = [
    `Registro shadow del refinador: ${total} tareas hacia especialistas.`,
    `Camino actual: passthrough — ninguna tarea se refina hoy.`,
    `El refinador shadow habría: reescrito ${rewritten}/${total}; dejado intactas ${total - rewritten} (L1).`,
    `Niveles: L1=${byLevel.L1} · L2=${byLevel.L2} · L3=${byLevel.L3}.`,
    `Escaladas al modelo caro (Sonnet): ${escalated}/${total} — el resto resuelto con Haiku barato.`,
    `Refinados: ${haikuRefines} con Haiku · ${sonnetRefines} con Sonnet.`,
    `Coste estimado: $${estCostUsd.toFixed(4)} (Haiku $${COST_PER_CALL_USD[HOT_MODEL]}/llamada, Sonnet $${COST_PER_CALL_USD[ESCALATION_MODEL]}/llamada).`,
  ].join('\n');
  return { total, rewritten, byLevel, escalated, haikuRefines, sonnetRefines, estCostUsd, text };
}
