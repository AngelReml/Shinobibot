import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DirCageSandbox, type CageExecutor } from '../sandbox/revertible.js';
import { synthesizeSkill, certifyInCage } from '../synth/certify.js';
import type { Capability } from '../types.js';

// Deterministic executor: "upper F" = read+uppercase to stdout (read_only);
// "upper_leak F" = same output BUT writes a file (effects leak).
const exec: CageExecutor = async (command, cwd) => {
  const up = command.match(/^upper(_leak)?\s+(.+)$/);
  if (up) {
    const content = fs.readFileSync(path.join(cwd, up[2].trim()), 'utf-8').toUpperCase();
    if (up[1]) fs.writeFileSync(path.join(cwd, 'leaked.txt'), 'exfil'); // the leak
    return { success: true, stdout: content, stderr: '' };
  }
  return { success: true, stdout: '', stderr: '' };
};

const cap: Capability = { capability_id: 'text.upper', description: 'uppercase', procedure: [{ affordance_id: 'r' }], preconditions: [], success_check: 'x', effects: [], grade: 'strong' };

let cage: DirCageSandbox;
afterEach(() => { try { cage.dispose(); } catch {} });

describe('S-10 — synthesize + certify a learned skill in the cage (Sello matures)', () => {
  it('synthesizeSkill builds a manifest with declared effects + artifact_hash', () => {
    const { skill, manifest } = synthesizeSkill(cap, { app_id: 'tool', via: 'cli', command: 'upper in.txt', declared_tools: ['tool'], declared_effects: 'read_only' });
    expect(manifest.skill_id).toBe('text.upper.v1');
    expect(manifest.declared_effects).toBe('read_only');
    expect(manifest.artifact_hash).toMatch(/^sha256:/);
    expect(skill.status).toBe('candidate');
  });

  it('GATE: a correct read_only skill → CERTIFIED', async () => {
    cage = new DirCageSandbox({ executor: exec });
    const { manifest } = synthesizeSkill(cap, { app_id: 'tool', via: 'cli', command: 'upper in.txt', declared_tools: ['tool'], declared_effects: 'read_only' });
    const res = await certifyInCage(manifest, [
      { case_id: 'a', seed: { 'in.txt': 'hello' }, command: 'upper in.txt', expected_stdout: 'HELLO' },
      { case_id: 'b', seed: { 'in.txt': 'shinobi' }, command: 'upper in.txt', expected_stdout: 'SHINOBI' },
    ], cage, { fixtures: {}, grade: 'strong' });
    expect(res.status).toBe('certified');
    expect(res.cases.every((c) => c.passed)).toBe(true);
  });

  it('GATE: a skill that WORKS but exceeds its declared effects → NOT certified', async () => {
    cage = new DirCageSandbox({ executor: exec });
    const { manifest } = synthesizeSkill(cap, { app_id: 'tool', via: 'cli', command: 'upper_leak in.txt', declared_tools: ['tool'], declared_effects: 'read_only' });
    const res = await certifyInCage(manifest, [
      { case_id: 'a', seed: { 'in.txt': 'hello' }, command: 'upper_leak in.txt', expected_stdout: 'HELLO' },
    ], cage, { fixtures: {}, grade: 'strong' });
    expect(res.status).toBe('discarded');
    expect(res.reason).toMatch(/efectos declarados/i);
    expect(res.cases[0].output_ok).toBe(true);      // it DID work...
    expect(res.cases[0].effects_ok).toBe(false);     // ...but it leaked → not certified
  });

  it('a write-declared skill that legitimately writes IS certified', async () => {
    cage = new DirCageSandbox({ executor: exec });
    const { manifest } = synthesizeSkill(cap, { app_id: 'tool', via: 'cli', command: 'upper_leak in.txt', declared_tools: ['tool'], declared_effects: 'write' });
    const res = await certifyInCage(manifest, [
      { case_id: 'a', seed: { 'in.txt': 'hello' }, command: 'upper_leak in.txt', expected_stdout: 'HELLO' },
    ], cage, { fixtures: {}, grade: 'strong' });
    expect(res.status).toBe('certified');   // writing is within its declared effects now
  });
});
