// src/agents/__tests__/team.test.ts
//
// Test del paralelismo REAL de mutaciones (Team). La prueba clave: dos agentes
// que escriben ficheros A LA VEZ, cada uno en su worktree+contexto, sin
// contaminación cruzada — lo que demuestra que el contexto ALS aísla el cwd bajo
// concurrencia (lo que process.chdir global NO podía).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTeam } from '../team.js';
import { WorktreeManager } from '../worktree.js';
import '../../tools/write_file.js'; // registra write_file real
import type { LLMInvoker } from '../agent_loop.js';

const envelope = (c: string) => JSON.stringify({ content: c });
// Stateless y seguro bajo concurrencia: si ya hubo un tool result, cierra; si no,
// emite un write_file con un nombre derivado de la tarea.
const writerInvoker: LLMInvoker = async (payload: any) => {
  const msgs = payload?.messages ?? [];
  if (msgs.some((m: any) => m.role === 'tool')) return { success: true, output: envelope('hecho'), error: '' };
  const task = String(msgs.find((m: any) => m.role === 'user')?.content ?? '');
  const letter = /\bA\b/.test(task) ? 'A' : 'B';
  return {
    success: true,
    output: JSON.stringify({ content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: `file_${letter}.txt`, content: letter }) } }] }),
    error: '',
  };
};

describe('runTeam — paralelismo real de mutaciones', () => {
  let repo: string;
  let mgr: WorktreeManager;
  const originalCwd = process.cwd();

  beforeAll(() => {
    process.env.SHINOBI_AUDIT_DISABLED = '1';
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-team-'));
    const run = (a: string[]) => {
      const r = spawnSync('git', a, { cwd: repo, encoding: 'utf-8' });
      if ((r.status ?? 1) !== 0) throw new Error(`git ${a.join(' ')} → ${r.stderr}`);
    };
    run(['init', '-q']);
    run(['config', 'user.email', 't@t.local']);
    run(['config', 'user.name', 'T']);
    run(['config', 'commit.gpgsign', 'false']);
    fs.writeFileSync(path.join(repo, 'README.md'), '# r\n');
    run(['add', '-A']);
    run(['commit', '-q', '-m', 'init']);
    mgr = new WorktreeManager({ repoRoot: repo, baseDir: path.join(repo, '.wt') });
  });

  afterAll(() => {
    delete process.env.SHINOBI_AUDIT_DISABLED;
    try { process.chdir(originalCwd); } catch { /* */ }
    try { fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 }); } catch { /* */ }
  });

  it('dos agentes escriben en paralelo SIN contaminación cruzada', async () => {
    const res = await runTeam({
      tasks: [
        { task: 'escribe el fichero A', label: 'agent-A', tools: ['write_file'] },
        { task: 'escribe el fichero B', label: 'agent-B', tools: ['write_file'] },
      ],
      manager: mgr,
      concurrency: 2, // ambos a la vez
      invokeLLM: writerInvoker,
    });

    expect(res.succeeded).toBe(2);
    expect(res.keptBranches.length).toBe(2); // ambos worktrees con cambios

    const a = res.results.find((r) => r.label === 'agent-A')!;
    const b = res.results.find((r) => r.label === 'agent-B')!;
    expect(a.kept).toBe(true);
    expect(b.kept).toBe(true);

    // AISLAMIENTO: el worktree de A tiene SOLO file_A.txt; el de B SOLO file_B.txt.
    expect(fs.existsSync(path.join(a.worktreePath!, 'file_A.txt'))).toBe(true);
    expect(fs.existsSync(path.join(a.worktreePath!, 'file_B.txt'))).toBe(false);
    expect(fs.existsSync(path.join(b.worktreePath!, 'file_B.txt'))).toBe(true);
    expect(fs.existsSync(path.join(b.worktreePath!, 'file_A.txt'))).toBe(false);

    // El cwd global del proceso NO se tocó (ALS, no chdir).
    expect(process.cwd()).toBe(originalCwd);

    // Limpieza.
    mgr.remove(a.worktreePath!, true);
    mgr.remove(b.worktreePath!, true);
  });

  it('sin repo git, falla limpio por miembro', async () => {
    const noRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-team-norepo-'));
    const res = await runTeam({
      tasks: [{ task: 'x' }],
      manager: new WorktreeManager({ repoRoot: noRepo, baseDir: path.join(noRepo, '.wt') }),
      invokeLLM: writerInvoker,
    });
    expect(res.succeeded).toBe(0);
    expect(res.results[0].error).toMatch(/git/i);
    fs.rmSync(noRepo, { recursive: true, force: true });
  });
});
