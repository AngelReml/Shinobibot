import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TaskQueueStore } from '../task_queue.js';

let dbDir: string;
let dbPath: string;
let store: TaskQueueStore;

beforeEach(() => {
  dbDir = join(tmpdir(), `shinobi-tasks-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dbDir, { recursive: true });
  dbPath = join(dbDir, 'tasks.db');
  store = new TaskQueueStore(dbPath);
});

afterEach(() => {
  try { store.close(); } catch {}
  try { if (existsSync(dbDir)) rmSync(dbDir, { recursive: true, force: true }); } catch {}
});

describe('TaskQueueStore', () => {
  it('adds tasks with correct default values and properties', () => {
    const task = store.addTask('Test Task', 'This is a test task description', 5);
    expect(task.id).toBeDefined();
    expect(task.title).toBe('Test Task');
    expect(task.description).toBe('This is a test task description');
    expect(task.priority).toBe(5);
    expect(task.status).toBe('pending');
    expect(task.assigned_to).toBeNull();
    expect(task.result).toBeNull();
    expect(task.error).toBeNull();
  });

  it('correctly claims tasks based on priority and creation time', () => {
    const t1 = store.addTask('Low Priority', 'Description', 1);
    const t2 = store.addTask('High Priority', 'Description', 10);
    const t3 = store.addTask('Medium Priority', 'Description', 5);

    // Should claim t2 first (priority 10)
    const claim1 = store.claimNextTask('agent_01');
    expect(claim1).not.toBeNull();
    expect(claim1!.id).toBe(t2.id);
    expect(claim1!.status).toBe('in_progress');
    expect(claim1!.assigned_to).toBe('agent_01');

    // Should claim t3 next (priority 5)
    const claim2 = store.claimNextTask('agent_02');
    expect(claim2!.id).toBe(t3.id);

    // Should claim t1 last (priority 1)
    const claim3 = store.claimNextTask('agent_03');
    expect(claim3!.id).toBe(t1.id);

    // No more tasks should be claimable
    const claim4 = store.claimNextTask('agent_04');
    expect(claim4).toBeNull();
  });

  it('completes in-progress tasks', () => {
    const task = store.addTask('Completable Task');
    expect(store.claimNextTask('agent')).not.toBeNull();

    const success = store.completeTask(task.id, 'Finished successfully!');
    expect(success).toBe(true);

    const updated = store.get(task.id)!;
    expect(updated.status).toBe('completed');
    expect(updated.result).toBe('Finished successfully!');
  });

  it('fails in-progress tasks', () => {
    const task = store.addTask('Failing Task');
    expect(store.claimNextTask('agent')).not.toBeNull();

    const success = store.failTask(task.id, 'An unexpected error occurred');
    expect(success).toBe(true);

    const updated = store.get(task.id)!;
    expect(updated.status).toBe('failed');
    expect(updated.error).toBe('An unexpected error occurred');
  });

  it('does not allow completing/failing tasks that are not in_progress', () => {
    const task = store.addTask('Pending Task');
    
    // Trying to complete a pending task should fail
    let success = store.completeTask(task.id, 'Result');
    expect(success).toBe(false);

    // Trying to fail a pending task should fail
    success = store.failTask(task.id, 'Error');
    expect(success).toBe(false);
  });
});
