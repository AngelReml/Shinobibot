/**
 * Tests E6 — SHUGYO MADURO
 *
 * Cubre:
 *   1. try/finally en certifyInCage — jaula siempre revertida aunque lance
 *   2. forgeSkill — puente Shugyo→Sello (certifica; descarta si se sale de efectos)
 *   3. PatternBook diversity budget — cap, jaccard, evicción por hit_rate
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DirCageSandbox, type CageExecutor } from '../sandbox/revertible.js';
import { certifyInCage } from '../synth/certify.js';
import { synthesizeSkill } from '../synth/certify.js';
import { forgeSkill } from '../forge.js';
import { PatternBook } from '../curve/patternbook.js';
import type { Capability } from '../types.js';

// ── Ejecutor determinista para los tests ────────────────────────────────────

const echoExec: CageExecutor = async (command) => {
  const m = command.match(/^echo\s+(.+)$/);
  if (m) return { success: true, stdout: m[1].trim(), stderr: '' };
  return { success: true, stdout: '', stderr: '' };
};

/** Ejecutor que escribe un archivo (simula fuga de efectos). */
const leakExec: CageExecutor = async (_cmd, cwd) => {
  fs.writeFileSync(path.join(cwd, 'leaked.txt'), 'exfil');
  return { success: true, stdout: 'ok', stderr: '' };
};

/** Ejecutor que lanza en el segundo caso. */
function throwOnCaseN(n: number): CageExecutor {
  let count = 0;
  return async (cmd) => {
    count++;
    if (count === n) throw new Error(`executor error on case ${n}`);
    return { success: true, stdout: 'ok', stderr: '' };
  };
}

let cage: DirCageSandbox;
afterEach(async () => { try { await cage.dispose(); } catch {} });

const baseCap: Capability = {
  capability_id: 'test.echo', description: 'echo cmd',
  procedure: [], preconditions: [], success_check: 'stdout', effects: [], grade: 'strong',
};

// ── 1. try/finally en certifyInCage ─────────────────────────────────────────

describe('E6 — certifyInCage: try/finally garantiza revert', () => {
  it('oracle vacío en caso 2 lanza pero la jaula queda revertida', async () => {
    cage = new DirCageSandbox({ executor: echoExec });
    cage.seed('a.txt', 'inicial');
    const before = cage.state().ref;

    const { manifest } = synthesizeSkill(baseCap, {
      app_id: 'app', via: 'cli', command: 'echo hello',
      declared_tools: [], declared_effects: 'read_only',
    });

    await expect(certifyInCage(manifest, [
      { case_id: 'c1', seed: {}, command: 'echo hello', expected_stdout: 'hello' },
      { case_id: 'c2', seed: {}, command: 'echo hello', expected_stdout: '' }, // oracle vacío → lanza
    ], cage)).rejects.toThrow(/oracle vacío/);

    // La jaula debe haber vuelto al estado antes de la certificación.
    expect(cage.state().ref).toBe(before);
  });

  it('executor que lanza: la jaula queda revertida al base pre-certificación', async () => {
    cage = new DirCageSandbox({ executor: throwOnCaseN(2) });
    cage.seed('data.txt', 'base');
    const before = cage.state().ref;

    const { manifest } = synthesizeSkill(baseCap, {
      app_id: 'app', via: 'cli', command: 'echo ok',
      declared_tools: [], declared_effects: 'read_only',
    });

    await expect(certifyInCage(manifest, [
      { case_id: 'c1', seed: {}, command: 'echo ok', expected_stdout: 'ok' },
      { case_id: 'c2', seed: {}, command: 'echo ok', expected_stdout: 'ok' }, // lanza en c2
    ], cage)).rejects.toThrow(/executor error/);

    expect(cage.state().ref).toBe(before);
  });

  it('happy path con 2 casos: jaula revertida al base después', async () => {
    cage = new DirCageSandbox({ executor: echoExec });
    cage.seed('f.txt', 'x');
    const before = cage.state().ref;

    const { manifest } = synthesizeSkill(baseCap, {
      app_id: 'app', via: 'cli', command: 'echo PASS',
      declared_tools: [], declared_effects: 'read_only',
    });
    const res = await certifyInCage(manifest, [
      { case_id: 'c1', seed: {}, command: 'echo PASS', expected_stdout: 'PASS' },
      { case_id: 'c2', seed: {}, command: 'echo PASS', expected_stdout: 'PASS' },
    ], cage);

    expect(res.status).toBe('certified');
    expect(cage.state().ref).toBe(before); // revertido al base vía finally
  });
});

// ── 2. forgeSkill (Shugyo→Sello) ────────────────────────────────────────────

describe('E6 — forgeSkill: puente Shugyo→Sello', () => {
  it('skill read_only que pasa el oracle → CERTIFIED', async () => {
    cage = new DirCageSandbox({ executor: echoExec });
    const r = await forgeSkill(baseCap, [
      { case_id: 'c1', seed: {}, command: 'echo OK', expected_stdout: 'OK' },
    ], cage, {
      app_id: 'myapp', via: 'cli', command: 'echo OK',
      declared_tools: ['run_command'], declared_effects: 'read_only',
    });

    expect(r.skill.status).toBe('certified');
    expect(r.certResult.status).toBe('certified');
    expect(r.manifest.artifact_hash).toMatch(/^sha256:/);
    expect(r.certResult.cases.every((c) => c.passed)).toBe(true);
  });

  it('skill read_only que escribe → DISCARDED (effects violation)', async () => {
    cage = new DirCageSandbox({ executor: leakExec });
    const r = await forgeSkill(baseCap, [
      { case_id: 'c1', seed: {}, command: 'echo ok', expected_stdout: 'ok' },
    ], cage, {
      app_id: 'myapp', via: 'cli', command: 'echo ok',
      declared_tools: [], declared_effects: 'read_only',
    });

    expect(r.skill.status).toBe('discarded');
    expect(r.certResult.status).toBe('discarded');
    expect(r.certResult.cases[0].output_ok).toBe(true);   // funcionó...
    expect(r.certResult.cases[0].effects_ok).toBe(false);  // ...pero se salió
  });

  it('write-declared skill que escribe → CERTIFIED', async () => {
    cage = new DirCageSandbox({ executor: leakExec });
    const r = await forgeSkill(baseCap, [
      { case_id: 'c1', seed: {}, command: 'echo ok', expected_stdout: 'ok' },
    ], cage, {
      app_id: 'myapp', via: 'cli', command: 'echo ok',
      declared_tools: [], declared_effects: 'write',
    });
    expect(r.skill.status).toBe('certified');
  });

  it('sin casos oracle → lanza antes de tocar la jaula', async () => {
    cage = new DirCageSandbox({ executor: echoExec });
    await expect(forgeSkill(baseCap, [], cage, {
      app_id: 'myapp', via: 'cli', command: 'echo ok',
      declared_tools: [], declared_effects: 'read_only',
    })).rejects.toThrow(/no hay casos oracle/);
  });

  it('store opcional persiste la skill', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { ShugyoStore } = await import('../store.js');
    const tmp = mkdtempSync(join(tmpdir(), 'fg_'));
    try {
      const store = new ShugyoStore({ db_path: join(tmp, 'test.db') });
      cage = new DirCageSandbox({ executor: echoExec });
      await forgeSkill(baseCap, [
        { case_id: 'c1', seed: {}, command: 'echo OK', expected_stdout: 'OK' },
      ], cage, {
        app_id: 'myapp', via: 'cli', command: 'echo OK',
        declared_tools: [], declared_effects: 'read_only',
        store,
      });
      const certified = store.listSkills('certified');
      expect(certified.length).toBe(1);
      expect(certified[0].capability_id).toBe('test.echo');
      store.close();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── 3. PatternBook diversity budget ─────────────────────────────────────────

describe('E6 — PatternBook diversity budget', () => {
  it('merge en idioma existente: siempre actualiza aunque corpus lleno', () => {
    const pb = new PatternBook([], { maxPatterns: 2 });
    pb.learn('open_file', { cues: ['open', 'file'], seenIn: 'app1' });
    pb.learn('save', { cues: ['save', 'write'], seenIn: 'app1' });
    // corpus lleno (maxPatterns=2) pero es un merge → debe actualizar
    pb.learn('open_file', { cues: ['open', 'launch'], seenIn: 'app2' });
    expect(pb.all().length).toBe(2);
    expect(pb.get('open_file')?.seen_in).toContain('app2');
  });

  it('idioma nuevo distinto cuando corpus lleno: evicta el menor hit_rate', () => {
    const pb = new PatternBook([], { maxPatterns: 2 });
    pb.learn('open_file', { cues: ['open', 'file'], seenIn: 'app1' });
    pb.learn('save', { cues: ['save', 'write'], seenIn: 'app1' });
    // hit_rate(open_file)=0, hit_rate(save)=0 → evicta uno cualquiera con hit_rate 0
    // Añadimos uno muy diferente (cues distintos)
    pb.learn('export_pdf', { cues: ['export', 'pdf', 'render'], seenIn: 'app2' });
    expect(pb.all().length).toBe(2); // sigue en cap
    expect(pb.get('export_pdf')).not.toBeNull(); // el nuevo entró
  });

  it('idioma nuevo demasiado similar (jaccard>0.8): se descarta, corpus sin cambios', () => {
    const pb = new PatternBook([], { maxPatterns: 2 });
    pb.learn('open_file', { cues: ['open', 'file', 'dialog'], seenIn: 'app1' });
    pb.learn('save', { cues: ['save', 'write'], seenIn: 'app1' });
    // "open_document" tiene cues {'open','file','menu'} — jaccard con {'open','file','dialog'} = 2/4 = 0.5 < 0.8 → entraría
    // Pero "open_doc_v2" con cues {'open','file','dialog','menu'} — jaccard con {'open','file','dialog'} = 3/4 = 0.75 < 0.8 → entraría
    // Necesitamos jaccard > 0.8: cues={'open','file','dialog','x'} vs {'open','file','dialog'} = 3/4 = 0.75 — hmm
    // Mejor: cues ={'open','file'} vs existing {'open','file','dialog'} = 2/3 ≈ 0.67 — no supera 0.8
    // Para superar 0.8: cues={'open','file','dialog'} vs {'open','file','dialog'} = 3/3 = 1.0 → descartado
    pb.learn('open_file_alias', { cues: ['open', 'file', 'dialog'], seenIn: 'app3' }); // idénticos cues → jaccard=1.0
    expect(pb.all().length).toBe(2); // descartado, corpus sin cambio
    expect(pb.get('open_file_alias')).toBeNull();
  });

  it('hit_rate 0 para los nuevos patrones', () => {
    const pb = new PatternBook();
    pb.learn('undo', { cues: ['undo', 'ctrl+z'], seenIn: 'app1' });
    expect(pb.get('undo')?.hit_rate).toBe(0);
  });

  it('recordOutcome actualiza hit_rate correctamente', () => {
    const pb = new PatternBook();
    pb.learn('export', { cues: ['export'], seenIn: 'app1' });
    pb.recordOutcome('export', true);   // aceleró
    pb.recordOutcome('export', false);  // no aceleró
    expect(pb.get('export')?.hit_rate).toBe(0.5); // 1 hit / (1 hit + 1 miss)
  });

  it('evicta el de menor hit_rate cuando corpus lleno con distintos rates', () => {
    const pb = new PatternBook([], { maxPatterns: 2 });
    pb.learn('undo', { cues: ['undo'], seenIn: 'app1' });
    pb.learn('save', { cues: ['save'], seenIn: 'app1' });
    // save tiene mejor hit_rate
    pb.recordOutcome('save', true);
    pb.recordOutcome('undo', false);
    // nuevo idioma distinto → debe evictar 'undo' (hit_rate=0) no 'save' (hit_rate=1)
    pb.learn('export_csv', { cues: ['export', 'csv', 'spreadsheet'], seenIn: 'app2' });
    expect(pb.all().length).toBe(2);
    expect(pb.get('save')).not.toBeNull();     // save sobrevive (mejor hit_rate)
    expect(pb.get('export_csv')).not.toBeNull(); // nuevo entra
    expect(pb.get('undo')).toBeNull();           // undo evictado
  });

  it('corpus sin restricción (default 100) acepta 100 patrones', () => {
    const pb = new PatternBook();
    for (let i = 0; i < 100; i++) {
      pb.learn(`idiom_${i}`, { cues: [`cue_${i}`, `unique_${i}`], seenIn: 'app' });
    }
    expect(pb.all().length).toBe(100);
    // El patrón 101 con cues distintos → debe evictar uno
    pb.learn('idiom_extra', { cues: ['totally_unique_xyz'], seenIn: 'app2' });
    expect(pb.all().length).toBe(100); // sigue en 100
  });
});
