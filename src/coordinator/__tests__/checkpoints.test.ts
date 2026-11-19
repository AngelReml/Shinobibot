// Plan Hermes — checkpoints de archivos y /rollback.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  beginCheckpointTurn, recordFileCheckpoint, recordFileWritten, rollbackLastTurn,
  listCheckpointTurns, describeRollback, describeCheckpoints, _resetCheckpointsForTests,
  CHECKPOINT_MAX_FILE_BYTES, CHECKPOINT_MAX_TURNS,
} from '../checkpoints.js';
import { handleSlashCommand } from '../slash_commands.js';

let dir: string;
const p = (n: string) => path.join(dir, n);
/** Simula lo que hacen write_file / edit_file. */
function agentWrite(file: string, content: string) {
  recordFileCheckpoint(file);
  fs.writeFileSync(file, content);
  recordFileWritten(file);
}

describe('checkpoints de archivos (/rollback)', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-ckpt-'));
    _resetCheckpointsForTests();
    delete process.env.SHINOBI_CHECKPOINTS;
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('restaura lo sobrescrito y borra lo creado en el último turno', () => {
    fs.writeFileSync(p('a.txt'), 'original');
    beginCheckpointTurn('cambia a y crea b');
    agentWrite(p('a.txt'), 'cambiado');
    agentWrite(p('b.txt'), 'nuevo');
    const r = rollbackLastTurn()!;
    expect(fs.readFileSync(p('a.txt'), 'utf-8')).toBe('original');
    expect(fs.existsSync(p('b.txt'))).toBe(false);
    expect(r.restored).toEqual([p('a.txt')]);
    expect(r.deleted).toEqual([p('b.txt')]);
    expect(rollbackLastTurn()).toBeNull();
  });

  it('varias escrituras al mismo archivo en un turno vuelven al estado de ANTES del turno', () => {
    fs.writeFileSync(p('a.txt'), 'v0');
    beginCheckpointTurn('t');
    agentWrite(p('a.txt'), 'v1');
    agentWrite(p('a.txt'), 'v2');
    rollbackLastTurn();
    expect(fs.readFileSync(p('a.txt'), 'utf-8')).toBe('v0');
  });

  it('deshace turno a turno, del más reciente al más antiguo, saltando los que no tocaron nada', () => {
    fs.writeFileSync(p('a.txt'), 'v0');
    beginCheckpointTurn('uno'); agentWrite(p('a.txt'), 'v1');
    beginCheckpointTurn('solo charla');
    beginCheckpointTurn('dos'); agentWrite(p('a.txt'), 'v2');
    beginCheckpointTurn('otra charla');
    expect(listCheckpointTurns().map(t => t.label)).toEqual(['uno', 'dos']);
    expect(rollbackLastTurn()!.label).toBe('dos');
    expect(fs.readFileSync(p('a.txt'), 'utf-8')).toBe('v1');
    expect(rollbackLastTurn()!.label).toBe('uno');
    expect(fs.readFileSync(p('a.txt'), 'utf-8')).toBe('v0');
  });

  it('no pisa un archivo que otra mano cambió después del agente', () => {
    fs.writeFileSync(p('a.txt'), 'original');
    beginCheckpointTurn('t');
    agentWrite(p('a.txt'), 'del agente');
    fs.writeFileSync(p('a.txt'), 'editado por el usuario');
    const r = rollbackLastTurn()!;
    expect(fs.readFileSync(p('a.txt'), 'utf-8')).toBe('editado por el usuario');
    expect(r.restored).toEqual([]);
    expect(r.skipped[0].reason).toMatch(/cambió después/);
    expect(describeRollback(r)).toMatch(/sin tocar/);
  });

  it('un archivo demasiado grande no se copia y se declara como no deshecho', () => {
    fs.writeFileSync(p('big.bin'), Buffer.alloc(CHECKPOINT_MAX_FILE_BYTES + 1, 1));
    beginCheckpointTurn('t');
    agentWrite(p('big.bin'), 'pequeño');
    const r = rollbackLastTurn()!;
    expect(r.skipped[0].reason).toMatch(/demasiado grande/);
    expect(fs.readFileSync(p('big.bin'), 'utf-8')).toBe('pequeño');
  });

  it('respeta el tope de turnos y SHINOBI_CHECKPOINTS=0 lo apaga', () => {
    for (let i = 0; i < CHECKPOINT_MAX_TURNS + 5; i++) { beginCheckpointTurn(`t${i}`); agentWrite(p(`f${i}.txt`), 'x'); }
    expect(listCheckpointTurns()).toHaveLength(CHECKPOINT_MAX_TURNS);
    _resetCheckpointsForTests();
    process.env.SHINOBI_CHECKPOINTS = '0';
    beginCheckpointTurn('t'); agentWrite(p('z.txt'), 'x');
    expect(rollbackLastTurn()).toBeNull();
    expect(describeCheckpoints()).toMatch(/No hay nada que deshacer/);
  });

  it('las tools reales write_file y edit_file dejan copia, y /rollback la restaura', async () => {
    const prevRoot = process.env.WORKSPACE_ROOT;
    process.env.WORKSPACE_ROOT = dir;
    try {
      const { default: writeFile } = await import('../../tools/write_file.js');
      const { default: editFile } = await import('../../tools/edit_file.js');
      fs.mkdirSync(p('scratch'));
      const f = p('scratch/nota.txt');
      fs.writeFileSync(f, 'hola mundo');
      beginCheckpointTurn('edita y crea');
      const e = await editFile.execute({ path: f, target: 'mundo', replacement: 'Shinobi' });
      const w = await writeFile.execute({ path: p('scratch/nueva.txt'), content: 'creada' });
      expect(e.error).toBeUndefined();
      expect(w.error).toBeUndefined();
      expect(fs.readFileSync(f, 'utf-8')).toBe('hola Shinobi');
      const logs: string[] = [];
      const orig = console.log; console.log = (...a: any[]) => { logs.push(a.join(' ')); };
      let handled = false;
      try { handled = await handleSlashCommand('/rollback', { ask: async () => '' } as any); } finally { console.log = orig; }
      expect(handled).toBe(true);
      expect(fs.readFileSync(f, 'utf-8')).toBe('hola mundo');
      expect(fs.existsSync(p('scratch/nueva.txt'))).toBe(false);
      expect(logs.join('\n')).toMatch(/Deshecho el turno/);
    } finally {
      if (prevRoot === undefined) delete process.env.WORKSPACE_ROOT; else process.env.WORKSPACE_ROOT = prevRoot;
    }
  });
});
