/**
 * Mission Replay — reconstruye y opcionalmente re-ejecuta una sesión de
 * Shinobi a partir de audit.jsonl.
 *
 * Modos:
 *   - timeline(opts):    devuelve la secuencia ordenada de eventos.
 *   - summarize(opts):   stats agregados (tool calls totales, fallos, loops).
 *   - dryRunReplay(opts, executor): re-ejecuta paso a paso con un
 *     executor inyectable, sin tocar producción.
 *
 * Diferenciador: ni Hermes ni OpenClaw permiten "rebobinar" una misión.
 * En Shinobi, cada misión es reproducible a partir de su audit log →
 * tooling para post-mortems, regression tests y benchmarking.
 */

import { existsSync, readFileSync } from 'fs';

export interface AuditLine {
  kind: 'tool_call' | 'loop_abort' | 'failover';
  ts: string;
  tool?: string;
  argsHash?: string;
  argsPreview?: string;
  success?: boolean;
  durationMs?: number;
  sessionId?: string;
  error?: string;
  verdict?: string;
  from?: string;
  to?: string;
  reason?: string;
}

export interface ReplayOptions {
  auditLogPath: string;
  /** Filtrar por sessionId (si tu audit tiene varias sesiones). */
  sessionId?: string;
  /** Filtrar por ventana temporal (ISO). */
  fromTs?: string;
  toTs?: string;
}

export interface ReplaySummary {
  totalEvents: number;
  toolCalls: number;
  toolCallFails: number;
  loopAborts: number;
  failovers: number;
  durationMs: number;
  tools: Record<string, { calls: number; fails: number; avgMs: number }>;
}

export function loadAudit(opts: ReplayOptions): AuditLine[] {
  if (!existsSync(opts.auditLogPath)) {
    throw new Error(`audit log not found: ${opts.auditLogPath}`);
  }
  const raw = readFileSync(opts.auditLogPath, 'utf-8');
  const out: AuditLine[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line) as AuditLine;
      if (opts.sessionId && ev.sessionId !== opts.sessionId) continue;
      if (opts.fromTs && ev.ts < opts.fromTs) continue;
      if (opts.toTs && ev.ts > opts.toTs) continue;
      out.push(ev);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

export function timeline(opts: ReplayOptions): AuditLine[] {
  return loadAudit(opts).sort((a, b) => a.ts.localeCompare(b.ts));
}

export function summarize(opts: ReplayOptions): ReplaySummary {
  const events = loadAudit(opts);
  const tools: Record<string, { calls: number; fails: number; avgMs: number }> = {};
  let toolCalls = 0;
  let toolCallFails = 0;
  let loopAborts = 0;
  let failovers = 0;
  let firstTs = '';
  let lastTs = '';

  for (const e of events) {
    if (!firstTs || e.ts < firstTs) firstTs = e.ts;
    if (!lastTs || e.ts > lastTs) lastTs = e.ts;
    if (e.kind === 'tool_call' && e.tool) {
      toolCalls++;
      if (!e.success) toolCallFails++;
      const bucket = tools[e.tool] ?? { calls: 0, fails: 0, avgMs: 0 };
      const newAvg = (bucket.avgMs * bucket.calls + (e.durationMs ?? 0)) / (bucket.calls + 1);
      bucket.calls++;
      if (!e.success) bucket.fails++;
      bucket.avgMs = Math.round(newAvg);
      tools[e.tool] = bucket;
    } else if (e.kind === 'loop_abort') {
      loopAborts++;
    } else if (e.kind === 'failover') {
      failovers++;
    }
  }

  const durationMs = firstTs && lastTs
    ? new Date(lastTs).getTime() - new Date(firstTs).getTime()
    : 0;

  return {
    totalEvents: events.length,
    toolCalls,
    toolCallFails,
    loopAborts,
    failovers,
    durationMs,
    tools,
  };
}

export type ReplayExecutor = (event: AuditLine, idx: number) => Promise<{
  ok: boolean;
  output?: string;
  error?: string;
}>;

export interface ReplayStepResult {
  index: number;
  ts: string;
  tool: string;
  ok: boolean;
  divergence?: string;
  durationMs: number;
}

/**
 * dryRunReplay re-ejecuta los eventos `tool_call` con un executor
 * inyectable. NO toca producción por sí mismo — el executor decide qué
 * hacer (en tests, un mock; en producción, una versión de tools
 * en modo sandbox).
 *
 * Si el resultado del executor difiere del audit original (éxito/fallo
 * o presencia de error), se reporta `divergence` para análisis.
 */
export async function dryRunReplay(
  opts: ReplayOptions,
  executor: ReplayExecutor
): Promise<ReplayStepResult[]> {
  const events = timeline(opts).filter(e => e.kind === 'tool_call' && e.tool);
  const results: ReplayStepResult[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i] as AuditLine;
    const t0 = Date.now();
    let r: { ok: boolean; output?: string; error?: string };
    try {
      r = await executor(e, i);
    } catch (err) {
      r = { ok: false, error: (err as Error).message };
    }
    const originalOk = !!e.success;
    const divergence = r.ok !== originalOk
      ? `original.success=${originalOk} vs replay.ok=${r.ok}`
      : undefined;
    results.push({
      index: i,
      ts: e.ts,
      tool: e.tool as string,
      ok: r.ok,
      divergence,
      durationMs: Date.now() - t0,
    });
  }
  return results;
}

export function formatSummary(s: ReplaySummary): string {
  const lines: string[] = [];
  lines.push('# Replay Summary');
  lines.push(`- eventos: ${s.totalEvents}`);
  lines.push(`- tool calls: ${s.toolCalls} (fallos: ${s.toolCallFails})`);
  lines.push(`- loop aborts: ${s.loopAborts}`);
  lines.push(`- failovers: ${s.failovers}`);
  lines.push(`- duración: ${s.durationMs}ms`);
  lines.push('');
  lines.push('## Tools');
  for (const [tool, st] of Object.entries(s.tools)) {
    lines.push(`- ${tool}: ${st.calls} calls (fails ${st.fails}, avg ${st.avgMs}ms)`);
  }
  return lines.join('\n');
}
