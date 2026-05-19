import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskQueueStore } from '../../persistence/task_queue.js';
import { SwarmWorker } from '../swarm_worker.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('Swarm Orchestration & Telemetry', () => {
  let dbPath: string;
  let queue: TaskQueueStore;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `shinobi_test_tasks_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
    queue = new TaskQueueStore(dbPath);
  });

  afterEach(() => {
    queue.close();
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    } catch {
      // Ignore cleanup error in tmp directory
    }
  });

  it('debe reclamar las tareas correspondientes a su rol o general, e ignorar otros roles', () => {
    // Insert tasks for coder, researcher and general
    queue.addTask('Fix authorization bug', 'Line 42 has a syntax error', 10, 'coder');
    queue.addTask('Search current weather API info', 'Analyze web search for weather API', 5, 'researcher');
    queue.addTask('Clean temp folder', 'Cleanup temp', 1, 'general');

    const coderWorker = new SwarmWorker('worker_coder_01', 'coder', [], queue, 'system prompt', 1000);
    const researcherWorker = new SwarmWorker('worker_research_01', 'researcher', [], queue, 'system prompt', 1000);

    // Coder worker claims. Should get the 'coder' task (highest priority) or 'general' task, but not 'researcher'
    const taskClaimedByCoder = queue.claimNextTask(coderWorker.agentId, coderWorker.role);
    expect(taskClaimedByCoder).not.toBeNull();
    expect(taskClaimedByCoder?.title).toBe('Fix authorization bug');
    expect(taskClaimedByCoder?.role_required).toBe('coder');

    // Researcher worker claims. Should get 'researcher' task
    const taskClaimedByResearcher = queue.claimNextTask(researcherWorker.agentId, researcherWorker.role);
    expect(taskClaimedByResearcher).not.toBeNull();
    expect(taskClaimedByResearcher?.title).toBe('Search current weather API info');
    expect(taskClaimedByResearcher?.role_required).toBe('researcher');

    // Coder worker claims next task. Should get the 'general' task (fallback support)
    const nextTaskClaimedByCoder = queue.claimNextTask(coderWorker.agentId, coderWorker.role);
    expect(nextTaskClaimedByCoder).not.toBeNull();
    expect(nextTaskClaimedByCoder?.title).toBe('Clean temp folder');
    expect(nextTaskClaimedByCoder?.role_required).toBe('general');
  });

  it('debe actualizar y reportar progreso intermedio reactivamente en SQLite', () => {
    const task = queue.addTask('Generate markdown summary', 'Format output as MD', 5, 'document_generator');
    
    // Claim task first so status is in_progress
    const claimed = queue.claimNextTask('worker_doc_01', 'document_generator');
    expect(claimed).not.toBeNull();

    // Simular un paso del bucle de pensamiento
    queue.updateTaskProgress(task.id, { current_tool: 'generate_document', steps_completed: 3 });

    // Consultar BD directamente
    const updatedTask = queue.get(task.id);
    expect(updatedTask).not.toBeNull();
    expect(updatedTask?.current_tool).toBe('generate_document');
    expect(updatedTask?.steps_completed).toBe(3);
    expect(updatedTask?.status).toBe('in_progress');

    // Simular fin de progreso
    queue.updateTaskProgress(task.id, { current_tool: null, steps_completed: 4 });
    const finishedStepTask = queue.get(task.id);
    expect(finishedStepTask?.current_tool).toBeNull();
    expect(finishedStepTask?.steps_completed).toBe(4);
  });
});
