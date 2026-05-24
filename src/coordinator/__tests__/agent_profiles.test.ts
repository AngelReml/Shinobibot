import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskQueueStore } from '../../persistence/task_queue.js';
import { getAgentProfile } from '../agent_profiles.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('agent_profiles factory + worker lifecycle', () => {
  let dbPath: string;
  let queue: TaskQueueStore;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `shinobi_profiles_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
    queue = new TaskQueueStore(dbPath);
  });

  afterEach(() => {
    queue.close();
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    } catch {
      // best-effort cleanup of tmp artifact
    }
  });

  it('crea un worker configurado por cada rol conocido', () => {
    for (const role of ['researcher', 'coder', 'document_generator']) {
      const w = getAgentProfile(role, `w_${role}`, queue, 60_000);
      expect(w.role).toBe(role);
      expect(w.agentId).toBe(`w_${role}`);
    }
  });

  it('lanza ante un rol desconocido', () => {
    expect(() => getAgentProfile('wizard', 'w_x', queue)).toThrow(/Unknown agent role/);
  });

  it('start() seguido de stop() no procesa la tarea ni lanza', () => {
    // Polling largo + stop inmediato: el timer se cancela antes de disparar,
    // así que el worker nunca reclama la tarea (ni hace una llamada LLM real).
    queue.addTask('noop task', 'should stay pending', 1, 'coder');
    const w = getAgentProfile('coder', 'w_coder', queue, 60_000);
    w.start();
    w.stop();

    const pending = queue.listTasks('pending');
    expect(pending.length).toBe(1);
    expect(pending[0].status).toBe('pending');
  });
});
