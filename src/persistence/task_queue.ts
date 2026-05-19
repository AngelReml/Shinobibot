import { createRequire } from 'node:module';
const requireFn = createRequire(typeof __filename !== 'undefined' ? __filename : import.meta.url);
const Database = requireFn('better-sqlite3');
import type BetterSqlite3 from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';

export interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  assigned_to: string | null;
  priority: number;
  result: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export class TaskQueueStore {
  private db: BetterSqlite3.Database;

  constructor(dbPath?: string) {
    const defaultDir = path.join(process.env.APPDATA || os.homedir(), 'Shinobi');
    if (!fs.existsSync(defaultDir)) fs.mkdirSync(defaultDir, { recursive: true });
    this.db = new Database(dbPath || path.join(defaultDir, 'tasks.db'));
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        assigned_to TEXT,
        priority INTEGER NOT NULL DEFAULT 0,
        result TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON task_items(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_priority ON task_items(priority DESC, created_at ASC);
    `);
  }

  public addTask(title: string, description?: string, priority: number = 0): TaskItem {
    const id = `tsk_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO task_items (id, title, description, status, assigned_to, priority, result, error, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', NULL, ?, NULL, NULL, ?, ?)
    `).run(id, title, description ?? null, priority, now, now);
    return this.get(id)!;
  }

  public get(id: string): TaskItem | null {
    const row = this.db.prepare('SELECT * FROM task_items WHERE id = ?').get(id);
    return row ? this.fromRow(row as any) : null;
  }

  public claimNextTask(agentId: string): TaskItem | null {
    // Atomically find the highest priority pending task and claim it.
    const now = new Date().toISOString();
    
    // We run this in a transaction to prevent race conditions when multiple agents try to claim simultaneously.
    const claimTx = this.db.transaction(() => {
      const task = this.db.prepare(`
        SELECT * FROM task_items 
        WHERE status = 'pending' 
        ORDER BY priority DESC, created_at ASC 
        LIMIT 1
      `).get() as any;

      if (!task) return null;

      this.db.prepare(`
        UPDATE task_items 
        SET status = 'in_progress', assigned_to = ?, updated_at = ? 
        WHERE id = ?
      `).run(agentId, now, task.id);

      return task.id;
    });

    const claimedId = claimTx();
    return claimedId ? this.get(claimedId) : null;
  }

  public completeTask(id: string, result: string): boolean {
    const now = new Date().toISOString();
    const r = this.db.prepare(`
      UPDATE task_items 
      SET status = 'completed', result = ?, updated_at = ? 
      WHERE id = ? AND status = 'in_progress'
    `).run(result, now, id);
    return r.changes > 0;
  }

  public failTask(id: string, error: string): boolean {
    const now = new Date().toISOString();
    const r = this.db.prepare(`
      UPDATE task_items 
      SET status = 'failed', error = ?, updated_at = ? 
      WHERE id = ? AND status = 'in_progress'
    `).run(error, now, id);
    return r.changes > 0;
  }

  public listTasks(status?: 'pending' | 'in_progress' | 'completed' | 'failed'): TaskItem[] {
    if (status) {
      return (this.db.prepare('SELECT * FROM task_items WHERE status = ? ORDER BY priority DESC, created_at ASC').all(status) as any[]).map(r => this.fromRow(r));
    }
    return (this.db.prepare('SELECT * FROM task_items ORDER BY priority DESC, created_at ASC').all() as any[]).map(r => this.fromRow(r));
  }

  public deleteTask(id: string): boolean {
    const r = this.db.prepare('DELETE FROM task_items WHERE id = ?').run(id);
    return r.changes > 0;
  }

  public clear(): void {
    this.db.exec('DELETE FROM task_items');
  }

  private fromRow(r: any): TaskItem {
    return {
      id: r.id,
      title: r.title,
      description: r.description ?? null,
      status: r.status,
      assigned_to: r.assigned_to ?? null,
      priority: r.priority,
      result: r.result ?? null,
      error: r.error ?? null,
      created_at: r.created_at,
      updated_at: r.updated_at
    };
  }

  public close(): void {
    this.db.close();
  }
}
