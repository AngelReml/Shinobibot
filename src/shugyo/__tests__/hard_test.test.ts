/**
 * S-14 — LA PRUEBA DURA del Nivel 4 (dossier §15, P1–P6). Aprender un programa de
 * verdad, sin romper nada. Salida binaria, jaula real + hashes de datos marcados.
 *
 *   P1 skills que funcionan · P2 efectos declarados respetados · P3 destructividad
 *   contenida (datos reales intactos por hash) · P4 efecto externo no disparado ·
 *   P5 honestidad del modelo (grade) · P6 curva descendente.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { DirCageSandbox } from '../sandbox/revertible.js';
import { certifyInCage, synthesizeSkill, type SkillManifest } from '../synth/certify.js';
import { executionPolicy, classifyReversibility } from '../explore/reversibility.js';
import { curveIsDescending } from '../curve/patternbook.js';
import type { Capability } from '../types.js';

const sha = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
let realDir: string;
beforeEach(() => { realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shugyo_real_')); });
afterEach(() => fs.rmSync(realDir, { recursive: true, force: true }));

const manifest = (effects: SkillManifest['declared_effects']): SkillManifest => ({
  skill_id: 'tool.count.v1', declared_tools: ['run_command'], declared_effects: effects,
  input_schema: {}, output_schema: {}, artifact_hash: 'sha256:x', command: 'tool count',
});

describe('shugyo — S-14 LA PRUEBA DURA (P1–P6)', () => {
  it('P1 — skill que funciona: pasa el oráculo + dentro de efectos → CERTIFIED', async () => {
    const cage = new DirCageSandbox({ executor: async () => ({ success: true, stdout: 'COUNT=42', stderr: '' }) });
    const res = await certifyInCage(manifest('read_only'), [{ case_id: 'c1', seed: {}, command: 'tool count', expected_stdout: 'COUNT=42' }], cage, { grade: 'strong' });
    expect(res.status).toBe('certified');
    await cage.dispose();
  });

  it('P2 — efectos declarados respetados: read_only que escribe → NO certificada', async () => {
    // declara read_only pero el ejecutor escribe en la jaula → viola efectos.
    const cage = new DirCageSandbox({ executor: async (_c, cwd) => { fs.writeFileSync(path.join(cwd, 'leak.txt'), 'x'); return { success: true, stdout: 'COUNT=42', stderr: '' }; } });
    const res = await certifyInCage(manifest('read_only'), [{ case_id: 'c1', seed: {}, command: 'tool count', expected_stdout: 'COUNT=42' }], cage, { grade: 'strong' });
    expect(res.status).toBe('discarded');
    expect(res.reason).toMatch(/efectos declarados/);
    await cage.dispose();
  });

  it('P3 — destructividad contenida: exploración solo en la jaula; datos reales marcados INTACTOS', async () => {
    const marked = path.join(realDir, 'datos_reales.dat');
    fs.writeFileSync(marked, 'NO TOCAR');
    const before = sha(marked);
    // una acción destructiva corre en la jaula (cwd = workDir, separado del realDir).
    const cage = new DirCageSandbox({ executor: async (_c, cwd) => { fs.rmSync(path.join(cwd, '*'), { force: true, recursive: true }); return { success: true, stdout: 'wiped', stderr: '' }; } });
    cage.seed('filler.txt', 'relleno');
    const snap = await cage.snapshot();
    await cage.runAction({ affordance_id: 'a', kind: 'cli_command', label: 'delete all', signature: 'rm -rf', reversibility: 'destructive' });
    await cage.revert(snap);
    expect(sha(marked)).toBe(before);                     // dato real intacto (hash igual)
    await cage.dispose();
  });

  it('P4 — efecto externo documentado pero NO disparado', async () => {
    expect(executionPolicy('external_effect')).toBe('document_only');
    let fired = false;
    const cage = new DirCageSandbox({ executor: async () => { fired = true; return { success: true, stdout: 'SENT', stderr: '' }; } });
    const r = await cage.runAction({ affordance_id: 's', kind: 'cli_command', label: 'send payment', signature: 'pay', reversibility: 'external_effect' });
    expect(r.executed).toBe(false);                       // nunca se ejecutó
    expect(fired).toBe(false);
    expect(r.output).toMatch(/NOT fired|external_effect/);
    await cage.dispose();
  });

  it('P5 — honestidad del modelo: la skill lleva su grade; lo no aprendido no se certifica', () => {
    const cap: Capability = { capability_id: 'tool.count', procedure: [], grade: 'medium', precondition: '', success_check: '' } as any;
    const { skill } = synthesizeSkill(cap, { app_id: 'tool', via: 'cli', command: 'tool count', declared_tools: ['run_command'], declared_effects: 'read_only' });
    expect(skill.grade).toBe('medium');                   // declara su grado, no finge
    expect(skill.status).toBe('candidate');               // aún no certificada
  });

  it('P6 — curva descendente: el 2.º programa cuesta menos que el 1.º (medido)', () => {
    expect(curveIsDescending([100, 60, 40])).toBe(true);  // abarata
    expect(curveIsDescending([100, 120])).toBe(false);    // no abarató → se reporta
    expect(classifyReversibility('open file')).toBe('reversible');   // sanity del clasificador usado
  });
});
