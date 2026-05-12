// src/web/chat_store.ts
//
// Bloque 6 — extraído de server.ts para reuso desde el gateway.
// Bloque 8.2 — extendido con conversations (tabla + columna en messages +
// migration idempotente al construir).
//
// Esquema actual:
//   conversations(id PK, title, created_at, last_active)
//   web_chat_messages(id PK, session_id, conversation_id, role, content,
//                     thinking_json, ts)
//
// Migration al boot:
//   - ALTER ADD COLUMN conversation_id (idempotente via try/catch)
//   - Si conversations vacía + hay messages legacy sin conversation_id:
//     crea una sola "Conversación inicial" y reasigna todos los huérfanos.
//
// Back-compat: add(sessionId, ...) sigue funcionando — internamente trata
// sessionId como conversationId y crea conversación fantasma si no existe.
// Esto preserva el gateway HTTP/Telegram del Bloque 6 sin cambios.

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface ChatRow {
  id: string;
  session_id: string;
  conversation_id: string | null;
  role: 'user' | 'agent' | 'system';
  content: string;
  thinking_json: string | null;
  ts: string;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  last_active: string;
}

export class ChatStore {
  private db: Database.Database;
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    // Tabla base de mensajes (legacy schema preservado).
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS web_chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        thinking_json TEXT,
        ts TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_session_ts ON web_chat_messages(session_id, ts);
    `);
    // Bloque 8.2 — añadir conversation_id idempotentemente.
    // SQLite no soporta ADD COLUMN IF NOT EXISTS; usamos try/catch.
    try {
      this.db.exec('ALTER TABLE web_chat_messages ADD COLUMN conversation_id TEXT');
    } catch { /* ya existe */ }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_conv_ts ON web_chat_messages(conversation_id, ts);
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_active TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conv_last_active ON conversations(last_active DESC);
    `);
    this.migrateLegacy();
  }

  /**
   * Si la tabla conversations está vacía y existen mensajes huérfanos sin
   * conversation_id, crea UNA "Conversación inicial" y los absorbe todos.
   * Idempotente: la segunda llamada (con conversations ya populada) no hace nada.
   */
  private migrateLegacy(): void {
    const convCount = (this.db.prepare('SELECT COUNT(*) AS c FROM conversations').get() as { c: number }).c;
    if (convCount > 0) return;
    const orphanCount = (this.db.prepare('SELECT COUNT(*) AS c FROM web_chat_messages WHERE conversation_id IS NULL').get() as { c: number }).c;
    if (orphanCount === 0) return;
    const id = `conv-initial-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO conversations (id, title, created_at, last_active) VALUES (?, ?, ?, ?)')
      .run(id, 'Conversación inicial', now, now);
    this.db.prepare('UPDATE web_chat_messages SET conversation_id = ? WHERE conversation_id IS NULL')
      .run(id);
    console.log(`[chat-store] migration: created '${id}' (Conversación inicial) absorbing ${orphanCount} legacy message(s).`);
  }

  // ─── Conversation CRUD ────────────────────────────────────────────────────

  createConversation(title: string = 'Conversación nueva'): Conversation {
    const id = `conv-${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO conversations (id, title, created_at, last_active) VALUES (?, ?, ?, ?)')
      .run(id, title, now, now);
    return { id, title, created_at: now, last_active: now };
  }

  listConversations(): Conversation[] {
    return this.db.prepare('SELECT id, title, created_at, last_active FROM conversations ORDER BY last_active DESC')
      .all() as Conversation[];
  }

  getConversation(id: string): Conversation | null {
    const row = this.db.prepare('SELECT id, title, created_at, last_active FROM conversations WHERE id = ?').get(id);
    return (row as Conversation) || null;
  }

  updateTitle(id: string, title: string): boolean {
    const r = this.db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, id);
    return r.changes > 0;
  }

  deleteConversation(id: string): boolean {
    // Soft cascade: borra también los mensajes vinculados.
    this.db.prepare('DELETE FROM web_chat_messages WHERE conversation_id = ?').run(id);
    const r = this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    return r.changes > 0;
  }

  /** Crea una conversación con id específico si no existe. Idempotente. */
  ensureConversation(id: string, title: string = 'Conversación'): Conversation {
    const existing = this.getConversation(id);
    if (existing) return existing;
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO conversations (id, title, created_at, last_active) VALUES (?, ?, ?, ?)')
      .run(id, title, now, now);
    return { id, title, created_at: now, last_active: now };
  }

  bumpLastActive(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE conversations SET last_active = ? WHERE id = ?').run(now, id);
  }

  /** Count user messages in a conversation (used by auto-title trigger). */
  countUserMessages(conversationId: string): number {
    const r = this.db.prepare('SELECT COUNT(*) AS c FROM web_chat_messages WHERE conversation_id = ? AND role = ?')
      .get(conversationId, 'user') as { c: number };
    return r.c;
  }

  /** First N user messages — used as seed for auto-title generation. */
  firstUserMessages(conversationId: string, n: number = 3): string[] {
    const rows = this.db.prepare('SELECT content FROM web_chat_messages WHERE conversation_id = ? AND role = ? ORDER BY ts ASC LIMIT ?')
      .all(conversationId, 'user', n) as { content: string }[];
    return rows.map(r => r.content);
  }

  // ─── Message ops ──────────────────────────────────────────────────────────

  /**
   * Back-compat para el Bloque 6 (gateway). Trata `sessionId` como
   * `conversationId`: crea conversación fantasma si no existe y delega.
   */
  add(sessionId: string, role: 'user' | 'agent' | 'system', content: string, thinking: string[] | null): ChatRow {
    this.ensureConversation(sessionId);
    return this.addInConversation(sessionId, role, content, thinking);
  }

  addInConversation(conversationId: string, role: 'user' | 'agent' | 'system', content: string, thinking: string[] | null): ChatRow {
    const row: ChatRow = {
      id: randomUUID(),
      session_id: conversationId,        // alias por compat con readers que aún miran session_id
      conversation_id: conversationId,
      role,
      content,
      thinking_json: thinking && thinking.length ? JSON.stringify(thinking) : null,
      ts: new Date().toISOString(),
    };
    this.db.prepare(
      'INSERT INTO web_chat_messages (id, session_id, conversation_id, role, content, thinking_json, ts) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(row.id, row.session_id, row.conversation_id, row.role, row.content, row.thinking_json, row.ts);
    this.bumpLastActive(conversationId);
    return row;
  }

  /** Back-compat: filtra por session_id O conversation_id (en el modelo nuevo son equivalentes). */
  list(sessionId: string, limit: number = 200): ChatRow[] {
    return this.db.prepare(
      'SELECT * FROM web_chat_messages WHERE conversation_id = ? OR session_id = ? ORDER BY ts ASC LIMIT ?'
    ).all(sessionId, sessionId, limit) as ChatRow[];
  }

  listByConversation(conversationId: string, limit: number = 500): ChatRow[] {
    return this.db.prepare(
      'SELECT * FROM web_chat_messages WHERE conversation_id = ? ORDER BY ts ASC LIMIT ?'
    ).all(conversationId, limit) as ChatRow[];
  }
}
