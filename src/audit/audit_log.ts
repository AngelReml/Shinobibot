/**
 * Audit Log — append-only JSONL para cada acción de Shinobi que el usuario
 * podría querer reconstruir después.
 *
 * Eventos cubiertos:
 *   - tool_call:  tool ejecutada con éxito o no, args hash + preview, latencia
 *   - loop_abort: detector v2 (LOOP_DETECTED / LOOP_NO_PROGRESS)
 *   - failover:   rotación cross-provider (X → Y, razón)
 *
 * Diseño:
 *   - Una línea JSON por evento, append-only. Fácil de grep/jq.
 *   - Path configurable via `SHINOBI_AUDIT_LOG_PATH` (default
 *     `<cwd>/audit.jsonl`).
 *   - Si el path no es escribible (read-only fs, etc.), el módulo no
 *     lanza — se desactiva silencioso. El audit no debe bloquear el flujo.
 *   - Args se hashean (SHA256) y se incluye un preview de 200 chars del
 *     JSON.stringify para no filtrar contenido sensible en bulk pero
 *     poder reconstruir manualmente.
 *
 * Diferenciador vs Hermes (Skills Guard audit log solo para skills) y
 * OpenClaw (logs dispersos en sandbox-info): Shinobi audita TODAS las
 * tool calls + loop aborts + failovers en un único stream.
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { createHash } from 'crypto';

export type AuditEventKind = 'tool_call' | 'loop_abort' | 'failover';

export interface ToolCallEvent {
  kind: 'tool_call';
  ts: string;
  tool: string;
  argsHash: string;
  argsPreview: string;
  success: boolean;
  durationMs: number;
  sessionId?: string;
  error?: string;
}

export interface LoopAbortEvent {
  kind: 'loop_abort';
  ts: string;
  tool: string;
  verdict: 'LOOP_DETECTED' | 'LOOP_NO_PROGRESS';
  argsHash: string;
  sessionId?: string;
}

export interface FailoverEvent {
  kind: 'failover';
  ts: string;
  from: string;
  to: string;
  reason: string;
}

export type AuditEvent = ToolCallEvent | LoopAbortEvent | FailoverEvent;

const ARGS_PREVIEW_CAP = 200;

function defaultPath(): string {
  return resolve(process.cwd(), 'audit.jsonl');
}

function resolveLogPath(): string {
  return process.env.SHINOBI_AUDIT_LOG_PATH
    ? resolve(process.env.SHINOBI_AUDIT_LOG_PATH)
    : defaultPath();
}

function hashArgs(args: unknown): string {
  try {
    return createHash('sha256').update(JSON.stringify(args)).digest('hex');
  } catch {
    return 'unhashable';
  }
}

function previewArgs(args: unknown): string {
  let s: string;
  try {
    s = JSON.stringify(args) ?? '';
  } catch {
    s = String(args);
  }
  if (s.length > ARGS_PREVIEW_CAP) s = s.slice(0, ARGS_PREVIEW_CAP) + `…[+${s.length - ARGS_PREVIEW_CAP}]`;
  return s;
}

/**
 * Escribe una entrada en el log. Si falla (path no writable, disco lleno),
 * no lanza — el audit es best-effort por diseño para no bloquear el agente.
 */
export function writeAuditEvent(event: AuditEvent): boolean {
  if (process.env.SHINOBI_AUDIT_DISABLED === '1') return false;
  const path = resolveLogPath();
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(path, JSON.stringify(event) + '\n', 'utf-8');
    return true;
  } catch {
    return false;
  }
}

export function logToolCall(args: {
  tool: string;
  args: unknown;
  success: boolean;
  durationMs: number;
  sessionId?: string;
  error?: string;
}): boolean {
  return writeAuditEvent({
    kind: 'tool_call',
    ts: new Date().toISOString(),
    tool: args.tool,
    argsHash: hashArgs(args.args),
    argsPreview: previewArgs(args.args),
    success: args.success,
    durationMs: Math.max(0, Math.round(args.durationMs)),
    sessionId: args.sessionId,
    error: args.error,
  });
}

export function logLoopAbort(args: {
  tool: string;
  verdict: 'LOOP_DETECTED' | 'LOOP_NO_PROGRESS';
  args: unknown;
  sessionId?: string;
}): boolean {
  return writeAuditEvent({
    kind: 'loop_abort',
    ts: new Date().toISOString(),
    tool: args.tool,
    verdict: args.verdict,
    argsHash: hashArgs(args.args),
    sessionId: args.sessionId,
  });
}

export function logFailover(args: { from: string; to: string; reason: string }): boolean {
  return writeAuditEvent({
    kind: 'failover',
    ts: new Date().toISOString(),
    from: args.from,
    to: args.to,
    reason: args.reason,
  });
}

/** Exporta helpers internos para tests. */
export const _internals = { hashArgs, previewArgs, resolveLogPath };
