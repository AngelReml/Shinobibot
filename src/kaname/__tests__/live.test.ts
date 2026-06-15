/**
 * Kaname live wiring: KernelHost real (fs sobre disco, behind the mediator) y
 * LaunchClaude real (subproceso inyectado, writes por git, backoff). fs validado de
 * verdad (a); exec/claude/git inyectables → testeable sin recursos vivos.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { makeFsKernelHost, makeClaudeLauncher, parseGitWrites, type Exec } from '../live.js';
import { makeMediator, SyscallDenied } from '../mediator.js';
import { integrateWrites } from '../swarm.js';
import type { SkillManifestLite, SwarmWorker } from '../types.js';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'kaname_live_')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('kaname/live — KernelHost real (fs) tras el mediator', () => {
  const manifest: SkillManifestLite = { skill_id: 's', declared_tools: [], declared_effects: 'write', reads: ['in.txt'], writes: ['out.txt'] };

  it('lee/escribe ficheros reales confinados a la jaula; el original existe', async () => {
    fs.writeFileSync(path.join(root, 'in.txt'), 'datos');
    const host = makeFsKernelHost({ root });
    const sys = makeMediator(manifest, host);
    const got = await sys.readInput('in.txt');
    expect(got.data).toBe('datos');
    await sys.writeOutput('out.txt', { ref: 'out.txt', data: 'resultado' });
    expect(fs.readFileSync(path.join(root, 'out.txt'), 'utf-8')).toBe('resultado');   // escritura real (a)
  });

  it('rechaza path traversal fuera de la jaula', async () => {
    const host = makeFsKernelHost({ root });
    await expect(host.readInput('../../etc/passwd')).rejects.toThrow(/fuera de la jaula/);
  });

  it('el mediator sigue enforce-ando el contrato sobre el host real (P2)', async () => {
    fs.writeFileSync(path.join(root, 'secreto.txt'), 'x');
    const host = makeFsKernelHost({ root });
    const sys = makeMediator(manifest, host);
    await expect(sys.readInput('secreto.txt')).rejects.toBeInstanceOf(SyscallDenied);  // ref no declarada
  });

  it('invokeTool sin dispatcher falla honesto; con dispatcher delega', async () => {
    const noDisp = makeFsKernelHost({ root });
    await expect(noDisp.invokeTool('x', {})).rejects.toThrow(/sin dispatcher/);
    const withDisp = makeFsKernelHost({ root, invokeTool: async (t) => `ran ${t}` });
    expect(await withDisp.invokeTool('read_file', {})).toBe('ran read_file');
  });
});

describe('kaname/live — LaunchClaude real (subproceso inyectado)', () => {
  const worker: SwarmWorker = { worker_id: 'b1', role: 'builder', assigned_front: 'f1', workspace: '/wt/b1', status: 'running' };

  it('parseGitWrites extrae rutas de git status --porcelain (incluye renames)', () => {
    expect(parseGitWrites(' M src/skills/a.ts\n?? src/skills/b.ts\nR  old.ts -> src/skills/c.ts')).toEqual(['src/skills/a.ts', 'src/skills/b.ts', 'src/skills/c.ts']);
  });

  it('lanza claude, recoge writes por git y devuelve salida cruda', async () => {
    const exec: Exec = async (cmd) => cmd.startsWith('git status')
      ? { success: true, stdout: '?? src/skills/new.ts', stderr: '' }
      : { success: true, stdout: 'Tests 3 passed (3)', stderr: '' };
    const launch = makeClaudeLauncher({ exec, sleep: async () => {} });
    const r = await launch(worker, 'build a skill');
    expect(r.ok).toBe(true);
    expect(r.writes).toEqual(['src/skills/new.ts']);
    expect(r.raw_output).toMatch(/Tests 3 passed/);
    // y la integración bloquearía un write a núcleo si lo hubiera:
    expect(integrateWrites(r.writes).blocked).toEqual([]);
  });

  it('reintenta con backoff ante rate limit del plan (§7.3) y se recupera', async () => {
    let calls = 0;
    const exec: Exec = async (cmd) => {
      if (cmd.startsWith('git status')) return { success: true, stdout: '', stderr: '' };
      calls++;
      return calls === 1 ? { success: false, stdout: '', stderr: 'usage limit reached (429)' } : { success: true, stdout: 'ok', stderr: '' };
    };
    const sleep = vi.fn(async () => {});
    const launch = makeClaudeLauncher({ exec, sleep, maxRetries: 3 });
    const r = await launch(worker, 'x');
    expect(r.ok).toBe(true);
    expect(sleep).toHaveBeenCalledTimes(1);   // un backoff, luego éxito
    expect(calls).toBe(2);
  });

  it('si agota reintentos ante rate limit, devuelve ok=false honesto', async () => {
    const exec: Exec = async (cmd) => cmd.startsWith('git status')
      ? { success: true, stdout: '', stderr: '' }
      : { success: false, stdout: '', stderr: 'rate limit' };
    const launch = makeClaudeLauncher({ exec, sleep: async () => {}, maxRetries: 2 });
    expect((await launch(worker, 'x')).ok).toBe(false);
  });
});
