// F2.8 (auditoria 2026-07) - paridad de filtro DESTRUCTIVE_TOOLS entre
// run_swarm.ts (filtra visible/inline) y run_team.ts (el filtro real vive en
// runTeam(), src/agents/team.ts - ver comentario anadido en run_team.ts que
// apunta aqui). Espeja el enfoque: un team NO puede recibir una tool
// destructiva no-worktree-safe (p.ej. run_command) sin que se filtre antes
// de llegar al agente - el LLM invocado nunca debe ver esa tool en su caja.
//
// write_file/edit_file SI deben sobrevivir el filtro (WORKTREE_SAFE): cada
// miembro del equipo escribe en su propio worktree git aislado, asi que
// mutar ficheros es justo el proposito de esta tool.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTeam } from '../team.js';
import { WorktreeManager } from '../worktree.js';
import { DESTRUCTIVE_TOOLS } from '../../security/approval.js';
import '../../tools/write_file.js'; // registra write_file real
import '../../tools/edit_file.js'; // registra edit_file real (para probar que WORKTREE_SAFE lo deja pasar)
import type { LLMInvoker } from '../agent_loop.js';

describe('runTeam - filtro DESTRUCTIVE_TOOLS (F2.8, paridad con run_swarm)', () => {
  let repo: string;
  let mgr: WorktreeManager;
  const originalCwd = process.cwd();

  beforeAll(() => {
    process.env.SHINOBI_AUDIT_DISABLED = '1';
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-team-filter-'));
    const run = (a: string[]) => {
      const r = spawnSync('git', a, { cwd: repo, encoding: 'utf-8' });
      if ((r.status ?? 1) !== 0) throw new Error(`git ${a.join(' ')} -> ${r.stderr}`);
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

  it('run_command (destructiva, NO worktree-safe) nunca llega a la caja de tools del LLM', async () => {
    const seenToolNames: string[][] = [];
    const capturingInvoker: LLMInvoker = async (payload: any) => {
      const names = (payload?.tools ?? []).map((t: any) => t?.function?.name ?? t?.name).filter(Boolean);
      seenToolNames.push(names);
      // Cierra inmediatamente - no necesitamos ejecutar tools de verdad.
      return { success: true, output: JSON.stringify({ content: 'listo' }), error: '' };
    };

    await runTeam({
      tasks: [
        { task: 'intenta borrar todo', label: 'malicious-member', tools: ['run_command', 'write_file'] },
      ],
      manager: mgr,
      concurrency: 1,
      invokeLLM: capturingInvoker,
    });

    expect(seenToolNames.length).toBeGreaterThan(0);
    for (const names of seenToolNames) {
      expect(names).not.toContain('run_command');
    }
  });

  it('write_file/edit_file (destructivas pero WORKTREE_SAFE) SI sobreviven el filtro', async () => {
    const seenToolNames: string[][] = [];
    const capturingInvoker: LLMInvoker = async (payload: any) => {
      const names = (payload?.tools ?? []).map((t: any) => t?.function?.name ?? t?.name).filter(Boolean);
      seenToolNames.push(names);
      return { success: true, output: JSON.stringify({ content: 'listo' }), error: '' };
    };

    await runTeam({
      tasks: [
        { task: 'escribe un fichero', label: 'legit-member', tools: ['write_file', 'edit_file', 'run_command'] },
      ],
      manager: mgr,
      concurrency: 1,
      invokeLLM: capturingInvoker,
    });

    expect(seenToolNames.length).toBeGreaterThan(0);
    const firstCall = seenToolNames[0];
    expect(firstCall).toContain('write_file');
    expect(firstCall).toContain('edit_file');
    expect(firstCall).not.toContain('run_command');
  });

  it('DESTRUCTIVE_TOOLS (fuente compartida con run_swarm.ts) contiene run_command', () => {
    // Confirma que ambos tools (team y swarm) leen del MISMO Set - no hay
    // dos listas divergentes mantenidas a mano.
    expect(DESTRUCTIVE_TOOLS.has('run_command')).toBe(true);
  });
});
