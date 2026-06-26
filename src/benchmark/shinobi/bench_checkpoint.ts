// src/benchmark/shinobi/bench_checkpoint.ts
//
// Checkpoint por task_id para crash recovery e idempotencia del servidor HTTP.
//
// Flujo:
//   startCheckpoint(id)        → marca la tarea como "running"
//   completeCheckpoint(id, o)  → marca "done", guarda output (para replay)
//   failCheckpoint(id, e)      → marca "failed" (re-runnable en el siguiente intento)
//   getCheckpoint(id)          → lee el estado actual
//
// Si el proceso muere con una tarea en "running", al restart se puede detectar
// y reportar al runner externo que la tarea quedó a medias.
//
// Almacenamiento: JSON plano en SHINOBI_BENCH_CHECKPOINT_FILE
//   (default: <os.tmpdir()>/shinobi-bench-checkpoints.json).
// Escritura atómica: escribe en .tmp y renombra, evita corrupción.

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

export type CheckpointStatus = 'running' | 'done' | 'failed';

export interface TaskCheckpoint {
  status: CheckpointStatus;
  started_at: number;
  completed_at?: number;
  output?: string;
  error?: string;
}

type CheckpointStore = Record<string, TaskCheckpoint>;

function storePath(): string {
  return (
    process.env.SHINOBI_BENCH_CHECKPOINT_FILE ||
    path.join(os.tmpdir(), 'shinobi-bench-checkpoints.json')
  );
}

function load(): CheckpointStore {
  const p = storePath();
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as CheckpointStore;
  } catch {
    return {};
  }
}

function save(store: CheckpointStore): void {
  const p = storePath();
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

export function startCheckpoint(taskId: string): void {
  const store = load();
  store[taskId] = { status: 'running', started_at: Date.now() };
  save(store);
}

export function completeCheckpoint(taskId: string, output: string): void {
  const store = load();
  const existing = store[taskId] ?? { started_at: Date.now() };
  store[taskId] = { ...existing, status: 'done', completed_at: Date.now(), output };
  save(store);
}

export function failCheckpoint(taskId: string, error: string): void {
  const store = load();
  const existing = store[taskId] ?? { started_at: Date.now() };
  store[taskId] = { ...existing, status: 'failed', completed_at: Date.now(), error };
  save(store);
}

export function getCheckpoint(taskId: string): TaskCheckpoint | undefined {
  return load()[taskId];
}
