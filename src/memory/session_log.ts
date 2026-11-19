/**
 * session_log — diario buscable de conversaciones pasadas (mejora tomada de
 * Hermes Agent: «session search»).
 *
 * El historial vivo (memory.json) solo guarda los últimos 30 mensajes; lo
 * anterior se perdía. Aquí se apunta cada petición del usuario y cada
 * respuesta final del agente en una base SQLite con índice de texto completo
 * (FTS5), para que la tool `session_search` pueda responder a «¿qué
 * decidimos sobre X?» semanas después.
 *
 * - Todo local, en el directorio de datos de Shinobi (`sessions.db`).
 * - No guarda resultados de tools (ahí viven los datos voluminosos y los
 *   secretos), solo lo que dijeron usuario y agente, recortado.
 * - `SHINOBI_SESSION_LOG=0` lo apaga. Un fallo aquí nunca rompe un turno.
 */
import { createRequire } from 'node:module';
const requireFn = createRequire(typeof __filename !== 'undefined' ? __filename : import.meta.url);
import type BetterSqlite3 from 'better-sqlite3';
import * as path from 'path';
import { shinobiDataDir } from '../runtime/data_dir.js';

export const SESSION_LOG_MAX_CHARS = 8000;
export const SESSION_SEARCH_MAX_RESULTS = 20;

export interface SessionHit {
  role: 'user' | 'assistant';
  snippet: string;
  date: string;
  sessionId: string;
}

let _db: BetterSqlite3.Database | null = null;
let _dbPath: string | null = null;
const _sessionId = new Date().toISOString().replace(/[:.]/g, '-');

/** Usuario del turno en curso (los turnos son exclusivos: ver orchestrator_mutex). */
let _activeUserId = '';
export function setSessionLogUser(userId?: string): void { _activeUserId = userId ?? ''; }
export function sessionLogUser(): string { return _activeUserId; }

export function sessionLogEnabled(): boolean {
  // Bajo la suite de tests no se escribe en el diario real del usuario.
  if (process.env.VITEST && !process.env.SHINOBI_SESSION_DB) return false;
  return process.env.SHINOBI_SESSION_LOG !== '0';
}

export function currentSessionId(): string {
  return _sessionId;
}

function db(): BetterSqlite3.Database {
  const wanted = process.env.SHINOBI_SESSION_DB || path.join(shinobiDataDir(), 'sessions.db');
  if (_db && _dbPath === wanted) return _db;
  if (_db) { try { _db.close(); } catch { /* ya cerrada */ } }
  const Database = requireFn('better-sqlite3');
  const d: BetterSqlite3.Database = new Database(wanted);
  d.pragma('journal_mode = WAL');
  d.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS session_messages USING fts5(
    content,
    role UNINDEXED, session_id UNINDEXED, user_id UNINDEXED, ts UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2'
  )`);
  _db = d; _dbPath = wanted;
  return d;
}

/** Apunta un mensaje. Nunca lanza. */
export function logSessionMessage(role: 'user' | 'assistant', content: unknown, userId?: string): void {
  if (!sessionLogEnabled()) return;
  try {
    const text = String(content ?? '').trim();
    if (!text) return;
    db().prepare('INSERT INTO session_messages (content, role, session_id, user_id, ts) VALUES (?, ?, ?, ?, ?)')
      .run(text.slice(0, SESSION_LOG_MAX_CHARS), role, _sessionId, userId ?? _activeUserId, new Date().toISOString());
  } catch { /* el diario es best-effort */ }
}

/**
 * Convierte texto libre en una consulta FTS5 segura: cada palabra entre
 * comillas (así ningún carácter se interpreta como operador), unidas por AND,
 * la última con prefijo. Devuelve '' si no queda nada buscable.
 */
export function toFtsQuery(raw: string): string {
  const words = String(raw ?? '').normalize('NFKC').split(/[^\p{L}\p{N}_]+/u).filter(w => w.length >= 2).slice(0, 12);
  if (words.length === 0) return '';
  return words.map((w, i) => `"${w}"${i === words.length - 1 ? '*' : ''}`).join(' AND ');
}

export function searchSessions(query: string, opts: { limit?: number; userId?: string; excludeCurrent?: boolean } = {}): SessionHit[] {
  if (!sessionLogEnabled()) return [];
  const fts = toFtsQuery(query);
  if (!fts) return [];
  const limit = Math.max(1, Math.min(SESSION_SEARCH_MAX_RESULTS, Math.floor(opts.limit ?? 8)));
  const where = ['session_messages MATCH ?', 'user_id = ?'];
  const params: any[] = [fts, opts.userId ?? _activeUserId];
  if (opts.excludeCurrent) { where.push('session_id <> ?'); params.push(_sessionId); }
  const rows = db().prepare(
    `SELECT role, session_id AS sessionId, ts,
            snippet(session_messages, 0, '', '', ' … ', 40) AS snippet
       FROM session_messages
      WHERE ${where.join(' AND ')}
      ORDER BY bm25(session_messages), ts DESC
      LIMIT ?`,
  ).all(...params, limit) as any[];
  return rows.map(r => ({ role: r.role, snippet: String(r.snippet ?? ''), date: String(r.ts ?? '').slice(0, 16).replace('T', ' '), sessionId: r.sessionId }));
}

export function sessionLogStats(userId?: string): { messages: number; sessions: number } {
  if (!sessionLogEnabled()) return { messages: 0, sessions: 0 };
  const r = db().prepare('SELECT COUNT(*) AS m, COUNT(DISTINCT session_id) AS s FROM session_messages WHERE user_id = ?').get(userId ?? _activeUserId) as any;
  return { messages: Number(r?.m ?? 0), sessions: Number(r?.s ?? 0) };
}

export function _closeSessionLogForTests(): void {
  if (_db) { try { _db.close(); } catch { /* */ } }
  _db = null; _dbPath = null; _activeUserId = '';
}
