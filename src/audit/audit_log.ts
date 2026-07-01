/**
 * Audit Log — append-only JSONL para cada acción de Shinobi que el usuario
 * podría querer reconstruir después.
 *
 * Eventos cubiertos:
 *   - tool_call:  tool ejecutada con éxito o no, args hash + preview, latencia
 *   - loop_abort: detector v3 (LOOP_DETECTED / LOOP_NO_PROGRESS / LOOP_SAME_FAILURE)
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

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { createHash } from 'crypto';
import { redactSecrets } from '../security/secret_redactor.js';
import { buildChain, GENESIS } from './audit_chain.js';

export type AuditEventKind = 'tool_call' | 'loop_abort' | 'failover' | 'approval_decision';

export interface ToolCallEvent {
  kind: 'tool_call';
  ts: string;
  tool: string;
  argsHash: string;
  argsPreview: string;
  success: boolean;
  durationMs: number;
  sessionId?: string;
  /** ALTA-10: usuario (slug multi-user) que disparó la tool, si se conoce. */
  userId?: string;
  error?: string;
}

export interface LoopAbortEvent {
  kind: 'loop_abort';
  ts: string;
  tool: string;
  verdict: 'LOOP_DETECTED' | 'LOOP_NO_PROGRESS' | 'LOOP_SAME_FAILURE';
  argsHash: string;
  sessionId?: string;
  /** ALTA-10: usuario (slug multi-user) que disparó la tool, si se conoce. */
  userId?: string;
}

export interface FailoverEvent {
  kind: 'failover';
  ts: string;
  from: string;
  to: string;
  reason: string;
  /** ALTA-10: usuario (slug multi-user) en cuya sesión ocurrió, si se conoce. */
  userId?: string;
}

export interface ApprovalDecisionEvent {
  kind: 'approval_decision';
  ts: string;
  tool: string;
  decision: 'allow' | 'deny';
  /** Razón de la acción crítica (del clasificador). */
  reason?: string;
  /** Modo de aprobación activo cuando se tomó la decisión. */
  mode: string;
  /** Si deny: fue por fail-safe (sin asker) o por voto explícito del usuario. */
  denySource?: 'no_asker' | 'user_no' | 'asker_error';
  sessionId?: string;
  /** ALTA-10: usuario (slug multi-user) que tomó/recibió la decisión, si se conoce. */
  userId?: string;
}

export type AuditEvent = ToolCallEvent | LoopAbortEvent | FailoverEvent | ApprovalDecisionEvent;

const ARGS_PREVIEW_CAP = 200;

function defaultPath(): string {
  return resolve(process.cwd(), 'audit.jsonl');
}

// MEDIA-10: `audit.jsonl` es un único fichero compartido por toda la
// instancia (no uno por usuario) — un guest con acceso de lectura al
// fichero ve `argsPreview`/`sessionId`/`userId` de TODOS los usuarios.
// Aislar logs por usuario es un cambio de arquitectura que queda fuera de
// alcance de este fix puntual. Mitigación parcial ya aplicada: cada evento
// ahora puede llevar `userId` (ver ALTA-10) para que, SI en el futuro
// aparece un endpoint de lectura scoped por usuario, pueda filtrar por ese
// campo. Hoy (grep de `loadTrustReport`/`resolveLogPath` en el repo) no
// existe ningún endpoint que sirva el contenido de audit.jsonl a un usuario
// concreto (ni en `src/web`, ni en `src/gateway`, ni en las tools de
// `src/tools`) — `trust_report` y `tool_search` agregan sobre TODO el log
// sin exponer eventos individuales, así que no hay nada que filtrar hoy.
// Riesgo residual: si se añade tal endpoint, DEBE filtrar por `userId` antes
// de servir líneas a un usuario no-owner.
function resolveLogPath(): string {
  return process.env.SHINOBI_AUDIT_LOG_PATH
    ? resolve(process.env.SHINOBI_AUDIT_LOG_PATH)
    : defaultPath();
}

/** Path del head persistido de la cadena de hashes para un log dado
 *  (CRIT-06). Un fichero por log (no uno global) para no mezclar cadenas
 *  cuando varios `audit.jsonl` conviven (tests, multi-instancia). */
function chainHeadPath(logPath: string): string {
  return `${logPath}.chainhead.json`;
}

/** Cache en memoria del último chainHash conocido por path de log, para no
 *  releer disco en cada escritura dentro del mismo proceso. */
const chainHeadCache = new Map<string, string>();

/**
 * Recupera el último `chainHash` conocido para `logPath` (CRIT-06):
 *   1. cache en memoria (proceso ya escribió antes en este path),
 *   2. `audit_chain_head.json` (persistido junto al log),
 *   3. última línea del propio log (recuperación si se perdió el head file
 *      pero el log sigue intacto),
 *   4. GENESIS si no hay nada de lo anterior (log nuevo).
 */
function getChainHead(logPath: string): string {
  const cached = chainHeadCache.get(logPath);
  if (cached) return cached;
  try {
    const headPath = chainHeadPath(logPath);
    if (existsSync(headPath)) {
      const raw = JSON.parse(readFileSync(headPath, 'utf-8'));
      if (raw && typeof raw.chainHash === 'string') {
        chainHeadCache.set(logPath, raw.chainHash);
        return raw.chainHash;
      }
    }
  } catch {
    /* head file corrupto/inaccesible — cae al fallback de leer el log. */
  }
  try {
    if (existsSync(logPath)) {
      const lines = readFileSync(logPath, 'utf-8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length) {
        const last = JSON.parse(lines[lines.length - 1]);
        if (last && typeof last.chainHash === 'string') {
          chainHeadCache.set(logPath, last.chainHash);
          return last.chainHash;
        }
      }
    }
  } catch {
    /* última línea corrupta/no parseable — empieza cadena nueva desde GENESIS. */
  }
  return GENESIS;
}

/** Persiste el nuevo head tras escribir una línea (cache + disco). */
function setChainHead(logPath: string, chainHash: string): void {
  chainHeadCache.set(logPath, chainHash);
  try {
    writeFileSync(chainHeadPath(logPath), JSON.stringify({ chainHash, updatedAt: new Date().toISOString() }), 'utf-8');
  } catch {
    /* best-effort: si no se puede persistir a disco, la cadena sigue viva
     * en memoria para el resto del proceso (igual que el resto del audit). */
  }
}

/** CRIT-07: que conste UNA vez por proceso que el audit trail está apagado. */
let auditDisabledWarned = false;

function hashArgs(args: unknown): string {
  try {
    // MEDIA-09: redacta secretos ANTES de hashear. Sin esto, un PIN/password
    // corto en `args` es brute-forceable offline (probar candidatos contra
    // el SHA-256 publicado en argsHash). Tras la redacción, dos secretos del
    // mismo tipo colapsan al mismo placeholder → el hash deja de ser un
    // oráculo útil para fuerza bruta sobre el valor real.
    const redacted = redactSecrets(JSON.stringify(args)).text;
    return createHash('sha256').update(redacted).digest('hex');
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
  if (process.env.SHINOBI_AUDIT_DISABLED === '1') {
    // CRIT-07: silenciar el audit trail sin dejar constancia es justo el tipo
    // de cosa que un atacante (o un operador con prisa) querría que pasara
    // desapercibida. Avisamos UNA vez por proceso — no en cada tool call —
    // para no inundar stderr, pero que quede visible en cualquier log del
    // proceso (consola, journal, servicio) que el audit está desactivado.
    if (!auditDisabledWarned) {
      auditDisabledWarned = true;
      console.warn(
        '[SECURITY] SHINOBI_AUDIT_DISABLED=1 — el audit trail está DESACTIVADO. ' +
        'Ninguna tool_call/loop_abort/failover/approval_decision se registrará en audit.jsonl mientras esta variable siga activa.',
      );
    }
    return false;
  }
  const path = resolveLogPath();
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    // Redacta secretos antes de persistir: el `argsPreview` de un tool_call
    // puede contener una API key / token. Sin esto, audit.jsonl filtraría
    // credenciales (hallazgo de la auditoría 2026-05-16).
    const contentJson = redactSecrets(JSON.stringify(event)).text;
    // CRIT-06: hash-chain — cada línea encadena el chainHash de la anterior
    // (ver audit_chain.ts). El hash se calcula sobre el contenido YA
    // redactado, porque eso es exactamente lo que queda escrito en disco; si
    // se hasheara el evento original, `verifyChain()` nunca podría
    // reproducirlo a partir del fichero. El head (chainHash de la última
    // línea) se persiste en `<path>.chainhead.json` para sobrevivir
    // reinicios del proceso.
    const prevHash = getChainHead(path);
    const { chainHash } = buildChain([contentJson], prevHash)[0];
    const line = JSON.stringify({ ...JSON.parse(contentJson), prevHash, chainHash });
    appendFileSync(path, line + '\n', 'utf-8');
    setChainHead(path, chainHash);
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
  /** ALTA-10: opcional — quién disparó la tool, si el caller lo conoce. */
  userId?: string;
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
    userId: args.userId,
    error: args.error,
  });
}

export function logLoopAbort(args: {
  tool: string;
  verdict: 'LOOP_DETECTED' | 'LOOP_NO_PROGRESS' | 'LOOP_SAME_FAILURE';
  args: unknown;
  sessionId?: string;
  /** ALTA-10: opcional — quién disparó la tool, si el caller lo conoce. */
  userId?: string;
}): boolean {
  return writeAuditEvent({
    kind: 'loop_abort',
    ts: new Date().toISOString(),
    tool: args.tool,
    verdict: args.verdict,
    argsHash: hashArgs(args.args),
    sessionId: args.sessionId,
    userId: args.userId,
  });
}

export function logFailover(args: { from: string; to: string; reason: string; userId?: string }): boolean {
  return writeAuditEvent({
    kind: 'failover',
    ts: new Date().toISOString(),
    from: args.from,
    to: args.to,
    reason: args.reason,
    userId: args.userId,
  });
}

export function logApprovalDecision(args: {
  tool: string;
  decision: 'allow' | 'deny';
  reason?: string;
  mode: string;
  denySource?: ApprovalDecisionEvent['denySource'];
  sessionId?: string;
  /** ALTA-10: opcional — quién recibió la decisión, si el caller lo conoce. */
  userId?: string;
}): boolean {
  return writeAuditEvent({
    kind: 'approval_decision',
    ts: new Date().toISOString(),
    tool: args.tool,
    decision: args.decision,
    reason: args.reason,
    mode: args.mode,
    denySource: args.denySource,
    sessionId: args.sessionId,
    userId: args.userId,
  });
}

/** Exporta helpers internos para tests. */
export const _internals = { hashArgs, previewArgs, resolveLogPath, chainHeadPath, getChainHead };
