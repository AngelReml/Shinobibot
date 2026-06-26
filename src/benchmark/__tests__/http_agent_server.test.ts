// src/benchmark/shinobi/__tests__/http_agent_server.test.ts
//
// Tests del servidor HTTP del agente (Fase 0 + Fase 1).
// Usa mocks para aislar la lógica del servidor sin necesitar providers reales.

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../shinobi/task_router.js', () => ({
  routeTask: vi.fn(async (_task: unknown, _dir: string) => 'mock output'),
}));

// Redirigir checkpoints a un temporal por test
const tmpCheckpoint = path.join(os.tmpdir(), `shinobi-bench-srv-test-${process.pid}.json`);
process.env.SHINOBI_BENCH_CHECKPOINT_FILE = tmpCheckpoint;

import { startBenchAgentServer } from '../shinobi/http_agent_server.js';
import { routeTask } from '../shinobi/task_router.js';
import { getCheckpoint } from '../shinobi/bench_checkpoint.js';

let stop: () => Promise<void>;
let port: number;

beforeAll(async () => {
  const srv = await startBenchAgentServer({ port: 0 });
  port = srv.port;
  stop = srv.stop;
});

afterAll(async () => {
  await stop();
  try { fs.unlinkSync(tmpCheckpoint); } catch { /* ok */ }
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(routeTask).mockResolvedValue('mock output');
  try { fs.unlinkSync(tmpCheckpoint); } catch { /* ok */ }
});

async function post(body: unknown): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('devuelve ok y version', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    const data = await res.json() as { ok: boolean; version: string };
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(typeof data.version).toBe('string');
  });
});

describe('POST / — validación', () => {
  it('400 si body vacío', async () => {
    const { status } = await post({});
    expect(status).toBe(400);
  });

  it('400 si task.prompt falta', async () => {
    const { status } = await post({ task: { id: 't', category: 'reasoning' }, files_dir: '' });
    expect(status).toBe(400);
  });
});

describe('POST / — flujo normal', () => {
  it('devuelve { output: string } en tarea válida', async () => {
    const { status, data } = await post({
      task: { id: 'task-a', category: 'reasoning', prompt: '2+2?' },
      files_dir: '',
    });
    expect(status).toBe(200);
    expect((data as { output: string }).output).toBe('mock output');
  });

  it('T5.3 — redacta secretos del output', async () => {
    vi.mocked(routeTask).mockResolvedValue('Aquí está tu key: sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    const { status, data } = await post({
      task: { id: 'task-sec', category: 'reasoning', prompt: 'dame la key' },
      files_dir: '',
    });
    expect(status).toBe(200);
    const output = (data as { output: string }).output;
    expect(output).not.toContain('sk-ant-api03-');
    expect(output).toContain('<REDACTED:');
  });

  it('T6.1 — segunda llamada con mismo task_id devuelve cached sin llamar routeTask', async () => {
    vi.mocked(routeTask).mockResolvedValue('resultado original');

    // Primera llamada
    await post({ task: { id: 'task-idem', category: 'reasoning', prompt: 'q' }, files_dir: '' });
    expect(vi.mocked(routeTask)).toHaveBeenCalledTimes(1);

    // Segunda llamada con mismo id
    const { data } = await post({ task: { id: 'task-idem', category: 'reasoning', prompt: 'q' }, files_dir: '' });
    expect(vi.mocked(routeTask)).toHaveBeenCalledTimes(1); // no se llamó de nuevo
    expect((data as { output: string }).output).toBe('resultado original');
  });

  it('T6.1 — checkpoint queda en status done tras éxito', async () => {
    await post({ task: { id: 'task-cp', category: 'reasoning', prompt: 'x' }, files_dir: '' });
    const cp = getCheckpoint('task-cp');
    expect(cp?.status).toBe('done');
    expect(cp?.output).toBe('mock output');
  });
});
