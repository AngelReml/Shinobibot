// src/web/chat_store.ts
//
// Bloque 6 — extraído de server.ts para que el gateway (HTTP + Telegram)
// pueda persistir mensajes en la misma SQLite que la web local. WAL mode
// permite múltiples conexiones concurrentes al mismo archivo.

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface ChatRow {
  id: string;
  session_id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  thinking_json: string | null;
  ts: string;
}

export class ChatStore {
  private db: Database.Database;
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
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
  }
  add(sessionId: string, role: 'user' | 'agent' | 'system', content: string, thinking: string[] | null): ChatRow {
    const row: ChatRow = {
      id: randomUUID(),
      session_id: sessionId,
      role,
      content,
      thinking_json: thinking && thinking.length ? JSON.stringify(thinking) : null,
      ts: new Date().toISOString(),
    };
    this.db.prepare(
      'INSERT INTO web_chat_messages (id, session_id, role, content, thinking_json, ts) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(row.id, row.session_id, row.role, row.content, row.thinking_json, row.ts);
    return row;
  }
  list(sessionId: string, limit: number = 200): ChatRow[] {
    return this.db.prepare(
      'SELECT * FROM web_chat_messages WHERE session_id = ? ORDER BY ts ASC LIMIT ?'
    ).all(sessionId, limit) as ChatRow[];
  }
}
