// src/benchmark/shinobi/__tests__/bench_checkpoint.test.ts
//
// Tests del módulo de checkpoint por task_id (T6.1 crash recovery).

import { describe, it, expect, beforeEach } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import {
  startCheckpoint,
  completeCheckpoint,
  failCheckpoint,
  getCheckpoint,
} from '../shinobi/bench_checkpoint.js';

// Redirigir el archivo de checkpoints a un temporal para no contaminar /tmp.
const tmpFile = path.join(os.tmpdir(), `shinobi-bench-cp-test-${process.pid}.json`);

beforeEach(() => {
  process.env.SHINOBI_BENCH_CHECKPOINT_FILE = tmpFile;
  try { fs.unlinkSync(tmpFile); } catch { /* ok */ }
});

describe('bench_checkpoint', () => {
  it('getCheckpoint devuelve undefined para task desconocida', () => {
    expect(getCheckpoint('unknown-task')).toBeUndefined();
  });

  it('startCheckpoint marca la tarea como running', () => {
    startCheckpoint('t1');
    const cp = getCheckpoint('t1');
    expect(cp?.status).toBe('running');
    expect(typeof cp?.started_at).toBe('number');
  });

  it('completeCheckpoint guarda output y marca done', () => {
    startCheckpoint('t2');
    completeCheckpoint('t2', 'resultado de la tarea');
    const cp = getCheckpoint('t2');
    expect(cp?.status).toBe('done');
    expect(cp?.output).toBe('resultado de la tarea');
    expect(typeof cp?.completed_at).toBe('number');
  });

  it('failCheckpoint guarda error y marca failed', () => {
    startCheckpoint('t3');
    failCheckpoint('t3', 'algo salió mal');
    const cp = getCheckpoint('t3');
    expect(cp?.status).toBe('failed');
    expect(cp?.error).toBe('algo salió mal');
  });

  it('tareas independientes no se solapan', () => {
    startCheckpoint('t4');
    completeCheckpoint('t4', 'ok');
    startCheckpoint('t5');
    failCheckpoint('t5', 'error');

    expect(getCheckpoint('t4')?.status).toBe('done');
    expect(getCheckpoint('t5')?.status).toBe('failed');
  });

  it('escritura atómica: el archivo no queda corrupto si se lee inmediatamente', () => {
    startCheckpoint('t6');
    completeCheckpoint('t6', 'output final');
    const raw = fs.readFileSync(tmpFile, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
