// src/audit/trust_ledger.ts
//
// Motor E3 — EL AUDIT COMO SUSTRATO DE APRENDIZAJE.
//
// El audit.jsonl ya registra TODA tool call (éxito/latencia/error), loop aborts
// y failovers en un único stream uniforme. Eso es un activo que ningún
// competidor tiene (Hermes/OpenClaw loguean parcial/disperso). Aquí lo
// convertimos en TRUST-SCORES por herramienta: fiabilidad probada, latencia,
// modo de fallo dominante. Esa señal alimenta el ranking de herramientas (futuro
// tool-search), el curator y el routing — el sistema mejora cuanto más corre.
//
// Diseño:
//   - Funciones PURAS sobre eventos (computeToolTrust) para test determinista.
//   - Un loader que lee el JSONL (best-effort: salta líneas corruptas).
//   - Score por suavizado de Laplace: pocas llamadas → score neutro (~0.5);
//     muchas con éxito → ~1; muchas con fallo → ~0. Evita confiar/desconfiar de
//     una herramienta por un único dato.

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { classifyFailureMode } from '../coordinator/loop_detector.js';
import type { AuditEvent, ToolCallEvent } from './audit_log.js';

export interface ToolTrust {
  tool: string;
  calls: number;
  successes: number;
  failures: number;
  /** successes / calls (0 si no hay llamadas). */
  successRate: number;
  avgDurationMs: number;
  /** 0..1, suavizado de Laplace: (successes+1)/(calls+2). */
  score: number;
  /** ts de la última llamada vista. */
  lastSeen?: string;
  /** Modo de fallo de entorno dominante entre los fallos, si alguno. */
  topFailureMode?: string;
}

export interface TrustReport {
  /** Herramientas ordenadas por score descendente. */
  tools: ToolTrust[];
  /** Nº de eventos tool_call considerados. */
  fromEvents: number;
}

/** Parsea texto JSONL en eventos de audit; salta líneas corruptas. */
export function parseAuditLines(text: string): AuditEvent[] {
  const out: AuditEvent[] = [];
  for (const line of (text ?? '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const ev = JSON.parse(t);
      if (ev && typeof ev === 'object' && typeof ev.kind === 'string') out.push(ev as AuditEvent);
    } catch {
      /* línea corrupta — ignorar */
    }
  }
  return out;
}

interface Acc {
  calls: number;
  successes: number;
  failures: number;
  durationSum: number;
  lastSeen?: string;
  failureModes: Map<string, number>;
}

/** Agrega eventos en trust-scores por herramienta (función pura). */
export function computeToolTrust(events: AuditEvent[]): TrustReport {
  const map = new Map<string, Acc>();
  let considered = 0;

  for (const ev of events) {
    if (ev.kind !== 'tool_call') continue;
    const e = ev as ToolCallEvent;
    if (!e.tool) continue;
    considered++;
    let a = map.get(e.tool);
    if (!a) {
      a = { calls: 0, successes: 0, failures: 0, durationSum: 0, failureModes: new Map() };
      map.set(e.tool, a);
    }
    a.calls++;
    a.durationSum += Number.isFinite(e.durationMs) ? e.durationMs : 0;
    if (e.success) {
      a.successes++;
    } else {
      a.failures++;
      const mode = classifyFailureMode(e.error);
      if (mode) a.failureModes.set(mode, (a.failureModes.get(mode) ?? 0) + 1);
    }
    if (e.ts && (!a.lastSeen || e.ts > a.lastSeen)) a.lastSeen = e.ts;
  }

  const tools: ToolTrust[] = [];
  for (const [tool, a] of map) {
    let topFailureMode: string | undefined;
    let topCount = 0;
    for (const [m, c] of a.failureModes) {
      if (c > topCount) { topCount = c; topFailureMode = m; }
    }
    tools.push({
      tool,
      calls: a.calls,
      successes: a.successes,
      failures: a.failures,
      successRate: a.calls > 0 ? a.successes / a.calls : 0,
      avgDurationMs: a.calls > 0 ? Math.round(a.durationSum / a.calls) : 0,
      score: (a.successes + 1) / (a.calls + 2), // Laplace
      lastSeen: a.lastSeen,
      topFailureMode,
    });
  }
  // Orden: score desc, desempate por nº de llamadas desc, luego nombre.
  tools.sort((x, y) => y.score - x.score || y.calls - x.calls || x.tool.localeCompare(y.tool));
  return { tools, fromEvents: considered };
}

function defaultLogPath(): string {
  return process.env.SHINOBI_AUDIT_LOG_PATH
    ? resolve(process.env.SHINOBI_AUDIT_LOG_PATH)
    : resolve(process.cwd(), 'audit.jsonl');
}

/** Carga el trust report desde el audit.jsonl en disco (vacío si no existe). */
export function loadTrustReport(path?: string): TrustReport {
  const p = path ? resolve(path) : defaultLogPath();
  if (!existsSync(p)) return { tools: [], fromEvents: 0 };
  let text = '';
  try {
    text = readFileSync(p, 'utf-8');
  } catch {
    return { tools: [], fromEvents: 0 };
  }
  return computeToolTrust(parseAuditLines(text));
}

/**
 * Ordena nombres de herramientas por su trust-score (desc). Herramientas sin
 * historial reciben score neutro (0.5) y conservan su orden relativo de entrada
 * (orden estable). Es el punto de integración que consumirán tool-search y el
 * curator.
 */
export function rankToolNamesByTrust(names: string[], report: TrustReport): string[] {
  const score = new Map(report.tools.map((t) => [t.tool, t.score]));
  return names
    .map((name, i) => ({ name, i, s: score.get(name) ?? 0.5 }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.name);
}
