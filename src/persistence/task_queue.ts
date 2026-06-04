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
  role_required: string;
  current_tool: string | null;
  steps_completed: number;
  priority: number;
  result: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export class TaskQueueStore {
  private db: BetterSqlite3.Database;
  private progressBuffer = new Map<string, { current_tool: string | null; steps_completed: number; dirty: boolean }>();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(dbPath?: string) {
    const defaultDir = path.join(process.env.APPDATA || os.homedir(), 'Shinobi');
    if (!fs.existsSync(defaultDir)) fs.mkdirSync(defaultDir, { recursive: true });
    this.db = new Database(dbPath || path.join(defaultDir, 'tasks.db'));
    this.db.pragma('journal_mode = WAL');
    this.initSchema();

    // Start background asynchronous flush timer (every 200ms)
    this.flushTimer = setInterval(() => {
      this.flushProgress();
    }, 200);
  }

  private initSchema(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        assigned_to TEXT,
        role_required TEXT NOT NULL DEFAULT 'general',
        current_tool TEXT,
        steps_completed INTEGER DEFAULT 0,
        priority INTEGER NOT NULL DEFAULT 0,
        result TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON task_items(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_priority ON task_items(priority DESC, created_at ASC);
    `);
    const cols = (this.db.prepare(`PRAGMA table_info(task_items)`).all() as any[]).map(r => r.name);
    if (!cols.includes('role_required')) {
      this.db.exec(`ALTER TABLE task_items ADD COLUMN role_required TEXT NOT NULL DEFAULT 'general'`);
    }
    if (!cols.includes('current_tool')) {
      this.db.exec(`ALTER TABLE task_items ADD COLUMN current_tool TEXT`);
    }
    if (!cols.includes('steps_completed')) {
      this.db.exec(`ALTER TABLE task_items ADD COLUMN steps_completed INTEGER DEFAULT 0`);
    }
  }

  public addTask(title: string, description?: string, priority: number = 0, role_required: string = 'general'): TaskItem {
    const id = `tsk_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO task_items (id, title, description, status, assigned_to, role_required, priority, result, error, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', NULL, ?, ?, NULL, NULL, ?, ?)
    `).run(id, title, description ?? null, role_required, priority, now, now);
    return this.get(id)!;
  }

  public get(id: string): TaskItem | null {
    const row = this.db.prepare('SELECT * FROM task_items WHERE id = ?').get(id);
    if (!row) return null;
    const item = this.fromRow(row as any);
    const buffered = this.progressBuffer.get(id);
    if (buffered) {
      item.current_tool = buffered.current_tool;
      item.steps_completed = buffered.steps_completed;
    }
    return item;
  }

  public claimNextTask(agentId: string, roleRequired: string = 'general'): TaskItem | null {
    // Atomically find the highest priority pending task and claim it.
    const now = new Date().toISOString();
    
    // We run this in a transaction to prevent race conditions when multiple agents try to claim simultaneously.
    const claimTx = this.db.transaction(() => {
      const task = this.db.prepare(`
        SELECT * FROM task_items 
        WHERE status = 'pending' AND (role_required = ? OR role_required = 'general')
        ORDER BY priority DESC, created_at ASC 
        LIMIT 1
      `).get(roleRequired) as any;

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
    
    // Clean up task from buffer and get final steps count to flush immediately
    const buffered = this.progressBuffer.get(id);
    const stepsCompleted = buffered ? buffered.steps_completed : 0;
    this.progressBuffer.delete(id);

    const r = this.db.prepare(`
      UPDATE task_items 
      SET status = 'completed', result = ?, current_tool = NULL, steps_completed = ?, updated_at = ? 
      WHERE id = ? AND status = 'in_progress'
    `).run(result, stepsCompleted, now, id);
    return r.changes > 0;
  }

  public failTask(id: string, error: string): boolean {
    const now = new Date().toISOString();

    // Clean up task from buffer and get final steps count to flush immediately
    const buffered = this.progressBuffer.get(id);
    const stepsCompleted = buffered ? buffered.steps_completed : 0;
    this.progressBuffer.delete(id);

    const r = this.db.prepare(`
      UPDATE task_items 
      SET status = 'failed', error = ?, current_tool = NULL, steps_completed = ?, updated_at = ? 
      WHERE id = ? AND status = 'in_progress'
    `).run(error, stepsCompleted, now, id);
    return r.changes > 0;
  }

  public updateTaskProgress(id: string, progress: { current_tool?: string | null; steps_completed?: number }): void {
    const existing = this.progressBuffer.get(id) || { current_tool: null, steps_completed: 0 };
    const current_tool = progress.current_tool !== undefined ? progress.current_tool : existing.current_tool;
    const steps_completed = progress.steps_completed !== undefined ? progress.steps_completed : existing.steps_completed;

    this.progressBuffer.set(id, {
      current_tool,
      steps_completed,
      dirty: true
    });
  }

  public flushProgress(): void {
    const dirtyEntries: [string, { current_tool: string | null; steps_completed: number }][] = [];
    for (const [id, entry] of this.progressBuffer.entries()) {
      if (entry.dirty) {
        dirtyEntries.push([id, entry]);
        entry.dirty = false;
      }
    }

    if (dirtyEntries.length === 0) return;

    const now = new Date().toISOString();
    const updateStmt = this.db.prepare(`
      UPDATE task_items 
      SET current_tool = ?, steps_completed = ?, updated_at = ?
      WHERE id = ?
    `);

    const transaction = this.db.transaction((entries: [string, { current_tool: string | null; steps_completed: number }][]) => {
      for (const [id, entry] of entries) {
        updateStmt.run(entry.current_tool, entry.steps_completed, now, id);
      }
    });

    try {
      transaction(dirtyEntries);
    } catch (err) {
      console.error('[TaskQueueStore] Error flushing progress to DB:', err);
      // Restore dirty flags on error
      for (const [id] of dirtyEntries) {
        const entry = this.progressBuffer.get(id);
        if (entry) entry.dirty = true;
      }
    }
  }

  public listTasks(status?: 'pending' | 'in_progress' | 'completed' | 'failed'): TaskItem[] {
    let rows: any[];
    if (status) {
      rows = this.db.prepare('SELECT * FROM task_items WHERE status = ? ORDER BY priority DESC, created_at ASC').all(status);
    } else {
      rows = this.db.prepare('SELECT * FROM task_items ORDER BY priority DESC, created_at ASC').all();
    }
    return rows.map(r => {
      const item = this.fromRow(r);
      const buffered = this.progressBuffer.get(item.id);
      if (buffered) {
        item.current_tool = buffered.current_tool;
        item.steps_completed = buffered.steps_completed;
      }
      return item;
    });
  }

  public deleteTask(id: string): boolean {
    this.progressBuffer.delete(id);
    const r = this.db.prepare('DELETE FROM task_items WHERE id = ?').run(id);
    return r.changes > 0;
  }

  public clear(): void {
    this.progressBuffer.clear();
    this.db.exec('DELETE FROM task_items');
  }

  private fromRow(r: any): TaskItem {
    return {
      id: r.id,
      title: r.title,
      description: r.description ?? null,
      status: r.status,
      assigned_to: r.assigned_to ?? null,
      role_required: r.role_required ?? 'general',
      current_tool: r.current_tool ?? null,
      steps_completed: Number(r.steps_completed || 0),
      priority: r.priority,
      result: r.result ?? null,
      error: r.error ?? null,
      created_at: r.created_at,
      updated_at: r.updated_at
    };
  }

  public close(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushProgress();
    this.db.close();
  }
}
