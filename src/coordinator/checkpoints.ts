/**
 * checkpoints — volver atrás los archivos que el agente ha tocado (mejora
 * tomada de Hermes Agent: «checkpoints / rollback»).
 *
 * Antes de que `write_file` o `edit_file` escriban, se guarda cómo estaba el
 * archivo (o que no existía). Las copias se agrupan por turno del usuario;
 * `/rollback` deshace el último turno entero: restaura lo sobrescrito y borra
 * lo que el turno creó.
 *
 * Límites, a propósito:
 *  - Solo cubre lo escrito por esas dos tools. Lo que cambie `run_command`
 *    (un script, un instalador) NO se puede deshacer desde aquí.
 *  - Vive en memoria del proceso: al cerrar Shinobi se pierde.
 *  - Antes de restaurar comprueba que el archivo sigue como el agente lo
 *    dejó; si alguien lo cambió después, no lo pisa y lo dice.
 */
import * as fs from 'fs';
import * as crypto from 'crypto';

export const CHECKPOINT_MAX_FILE_BYTES = 2_000_000;
export const CHECKPOINT_MAX_TOTAL_BYTES = 50_000_000;
export const CHECKPOINT_MAX_TURNS = 20;

interface FileSnapshot {
  path: string;
  /** null = el archivo no existía antes del turno. */
  before: Buffer | null;
  /** true si no se pudo guardar copia (demasiado grande): no se puede deshacer. */
  skipped: boolean;
}

export interface CheckpointTurn {
  id: number;
  label: string;
  startedAt: number;
  files: FileSnapshot[];
}

export interface RollbackReport {
  turnId: number;
  label: string;
  restored: string[];
  deleted: string[];
  /** No se tocaron: cambiados después por otra mano, o sin copia. */
  skipped: { path: string; reason: string }[];
}

let _turns: CheckpointTurn[] = [];
let _nextId = 1;
let _totalBytes = 0;
/** hash del contenido que el agente dejó escrito, por ruta — para detectar cambios ajenos. */
const _afterHash = new Map<string, string>();

function enabled(): boolean {
  return process.env.SHINOBI_CHECKPOINTS !== '0';
}

function sha(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function dropOldest(): void {
  const t = _turns.shift();
  if (!t) return;
  for (const f of t.files) _totalBytes -= f.before?.length ?? 0;
}

/** Abre un turno nuevo. Lo llama el orquestador al empezar cada petición del usuario. */
export function beginCheckpointTurn(label: string): void {
  if (!enabled()) return;
  // Un turno que no tocó nada no ocupa sitio en la pila.
  const last = _turns[_turns.length - 1];
  if (last && last.files.length === 0) _turns.pop();
  _turns.push({ id: _nextId++, label: String(label ?? '').replace(/\s+/g, ' ').slice(0, 80), startedAt: Date.now(), files: [] });
  while (_turns.length > CHECKPOINT_MAX_TURNS) dropOldest();
}

/** Guarda el estado previo de `filePath`. Llamar JUSTO ANTES de escribir. Nunca lanza. */
export function recordFileCheckpoint(filePath: string): void {
  if (!enabled()) return;
  try {
    if (_turns.length === 0) beginCheckpointTurn('(sin turno)');
    const turn = _turns[_turns.length - 1];
    if (turn.files.some(f => f.path === filePath)) return; // ya guardado en este turno: vale el estado MÁS ANTIGUO
    let before: Buffer | null = null;
    let skipped = false;
    if (fs.existsSync(filePath)) {
      const st = fs.statSync(filePath);
      if (!st.isFile() || st.size > CHECKPOINT_MAX_FILE_BYTES) skipped = true;
      else before = fs.readFileSync(filePath);
    }
    turn.files.push({ path: filePath, before, skipped });
    _totalBytes += before?.length ?? 0;
    while (_totalBytes > CHECKPOINT_MAX_TOTAL_BYTES && _turns.length > 1) dropOldest();
  } catch { /* un fallo al guardar copia no debe impedir la escritura */ }
}

/** Anota cómo quedó el archivo tras escribir el agente. Llamar JUSTO DESPUÉS. Nunca lanza. */
export function recordFileWritten(filePath: string): void {
  if (!enabled()) return;
  try { _afterHash.set(filePath, sha(fs.readFileSync(filePath))); } catch { /* best-effort */ }
}

export function listCheckpointTurns(): { id: number; label: string; files: number; startedAt: number }[] {
  return _turns.filter(t => t.files.length > 0).map(t => ({ id: t.id, label: t.label, files: t.files.length, startedAt: t.startedAt }));
}

/** Deshace el último turno que tocó archivos. Devuelve null si no hay nada que deshacer. */
export function rollbackLastTurn(): RollbackReport | null {
  let idx = -1;
  for (let i = _turns.length - 1; i >= 0; i--) { if (_turns[i].files.length > 0) { idx = i; break; } }
  if (idx < 0) return null;
  const turn = _turns[idx];
  const report: RollbackReport = { turnId: turn.id, label: turn.label, restored: [], deleted: [], skipped: [] };
  // En orden inverso: lo último escrito se deshace primero.
  for (const f of [...turn.files].reverse()) {
    try {
      if (f.skipped) { report.skipped.push({ path: f.path, reason: 'era demasiado grande para guardar copia' }); continue; }
      const exists = fs.existsSync(f.path);
      const expected = _afterHash.get(f.path);
      if (exists && expected && sha(fs.readFileSync(f.path)) !== expected) {
        report.skipped.push({ path: f.path, reason: 'alguien lo cambió después de que el agente lo escribiera' });
        continue;
      }
      if (f.before === null) {
        if (exists) { fs.unlinkSync(f.path); report.deleted.push(f.path); }
      } else {
        fs.writeFileSync(f.path, f.before);
        report.restored.push(f.path);
      }
      _afterHash.delete(f.path);
    } catch (e: any) {
      report.skipped.push({ path: f.path, reason: String(e?.message ?? e) });
    }
  }
  for (const f of turn.files) _totalBytes -= f.before?.length ?? 0;
  _turns.splice(idx, 1);
  return report;
}

export function describeRollback(r: RollbackReport | null): string {
  if (!r) return 'No hay nada que deshacer: el agente no ha escrito archivos en esta sesión.';
  const lines = [`Deshecho el turno «${r.label}»:`];
  for (const p of r.restored) lines.push(`  ↩ restaurado  ${p}`);
  for (const p of r.deleted) lines.push(`  ✖ borrado (lo creó ese turno)  ${p}`);
  for (const s of r.skipped) lines.push(`  ⚠ sin tocar  ${s.path} — ${s.reason}`);
  if (r.restored.length + r.deleted.length === 0) lines.push('  (ningún archivo se pudo deshacer)');
  lines.push('Ojo: lo que hicieran los comandos de terminal de ese turno no se deshace.');
  return lines.join('\n');
}

export function describeCheckpoints(): string {
  const turns = listCheckpointTurns();
  if (turns.length === 0) return 'No hay nada que deshacer: el agente no ha escrito archivos en esta sesión.';
  const lines = turns.map(t => `  #${t.id}  ${t.files} archivo(s)  «${t.label}»`);
  return `Turnos que se pueden deshacer (el último primero con /rollback):\n${lines.reverse().join('\n')}`;
}

export function _resetCheckpointsForTests(): void {
  _turns = []; _nextId = 1; _totalBytes = 0; _afterHash.clear();
}
