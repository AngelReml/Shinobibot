// src/runtime/process_lock.ts
//
// FAIL 3 (Bloque 1, validación física): impide que CLI y Web (o dos CLIs)
// arranquen simultáneamente y corrompan estado compartido (SQLite, skills,
// el singleton estático del orchestrator).
//
// Lockfile: ./shinobi.lock (cwd, raíz del proyecto). Contiene un JSON con
// pid + cmd + timestamp. Si al arrancar el PID del lock sigue vivo, salimos
// con error claro. Si el PID está muerto (process crash, kill -9), el lock
// se considera stale y se reclama.
//
// Limpieza: handlers en 'exit', SIGINT, SIGTERM, uncaughtException,
// unhandledRejection — el lock se elimina siempre que sea posible.

import * as fs from 'fs';
import * as path from 'path';

export interface AcquireResult {
  acquired: boolean;
  ownerPid?: number;
  ownerCmd?: string;
  ownerStartedAt?: string;
}

interface LockFileBody {
  pid: number;
  cmd: string;
  started_at: string;
}

const DEFAULT_LOCK_PATH = path.join(process.cwd(), 'shinobi.lock');

let activeLockPath: string | null = null;
let cleanupRegistered = false;

function isAlive(pid: number): boolean {
  try {
    // Signal 0 doesn't actually send a signal — just checks whether the
    // process exists and we have permission to signal it.
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    if (e?.code === 'EPERM') return true;   // exists but we can't touch it
    return false;                            // ESRCH or other → dead
  }
}

function readLock(lockPath: string): LockFileBody | null {
  try {
    const raw = fs.readFileSync(lockPath, 'utf-8').trim();
    const parsed = JSON.parse(raw);
    if (typeof parsed?.pid !== 'number') return null;
    return {
      pid: parsed.pid,
      cmd: String(parsed.cmd ?? ''),
      started_at: String(parsed.started_at ?? ''),
    };
  } catch {
    return null;
  }
}

function writeLock(lockPath: string, cmd: string): void {
  const body: LockFileBody = {
    pid: process.pid,
    cmd,
    started_at: new Date().toISOString(),
  };
  fs.writeFileSync(lockPath, JSON.stringify(body, null, 2), 'utf-8');
}

export function acquireLock(cmd: string = 'shinobi', lockPath: string = DEFAULT_LOCK_PATH): AcquireResult {
  if (fs.existsSync(lockPath)) {
    const existing = readLock(lockPath);
    if (existing && isAlive(existing.pid)) {
      return {
        acquired: false,
        ownerPid: existing.pid,
        ownerCmd: existing.cmd,
        ownerStartedAt: existing.started_at,
      };
    }
    // Stale lock (corrupted file or dead PID) — reclaim.
    try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
  }
  writeLock(lockPath, cmd);
  activeLockPath = lockPath;
  registerCleanup();
  return { acquired: true };
}

export function releaseLock(): void {
  if (!activeLockPath) return;
  const lockPath = activeLockPath;
  activeLockPath = null;
  try {
    // Only unlink if the file still belongs to us. Belt-and-suspenders in
    // case something weird happened (e.g. user manually deleted then
    // another instance started before we cleaned up).
    const existing = readLock(lockPath);
    if (!existing || existing.pid === process.pid) {
      fs.unlinkSync(lockPath);
    }
  } catch { /* ignore */ }
}

function registerCleanup(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;

  const sync = () => releaseLock();

  process.on('exit', sync);
  process.on('SIGINT', () => { sync(); process.exit(130); });
  process.on('SIGTERM', () => { sync(); process.exit(143); });
  process.on('uncaughtException', (err) => {
    console.error('[shinobi] uncaughtException:', err);
    sync();
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    // Una promesa rechazada suelta NO debe tumbar un agente residente de
    // larga duración: el estado del proceso sigue siendo válido. Se loguea
    // de forma visible y se continúa. (uncaughtException sí sale: ahí el
    // estado puede estar corrupto.)
    console.error('[shinobi] unhandledRejection (no fatal, proceso continúa):', reason);
  });
}

export function formatLockedError(r: AcquireResult): string {
  return [
    'Shinobi ya está corriendo (PID ' + r.ownerPid + ', cmd=' + (r.ownerCmd || '?') + ').',
    'Cierra esa instancia primero.',
    r.ownerStartedAt ? '  iniciada en: ' + r.ownerStartedAt : '',
    '  lockfile : ' + DEFAULT_LOCK_PATH,
    '  si el proceso ya no existe, borra el lockfile manualmente.',
  ].filter(Boolean).join('\n');
}
