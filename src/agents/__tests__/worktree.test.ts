// src/agents/__tests__/worktree.test.ts
//
// Dos niveles: unit (git mockeado — parseo/args deterministas) e integración
// (git REAL sobre un repo temporal — validación real del aislamiento).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  WorktreeManager,
  parseWorktreeList,
  withWorktree,
  type GitRunner,
  type GitResult,
} from '../worktree.js';

// ── Unit (git mockeado) ──────────────────────────────────────────────────

function mockGit(handler: (args: string[], opts?: { cwd?: string }) => Partial<GitResult>) {
  const calls: string[][] = [];
  const fn: GitRunner = (args, opts) => {
    calls.push(args);
    const r = handler(args, opts) || {};
    return { code: r.code ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  return Object.assign(fn, { calls });
}

describe('WorktreeManager (unit, git mockeado)', () => {
  const baseDir = path.join(os.tmpdir(), 'shinobi-wt-unit');

  it('create construye los args correctos y devuelve rama+path', () => {
    const git = mockGit(() => ({ code: 0 }));
    const mgr = new WorktreeManager({ repoRoot: '/repo', baseDir, git });
    const wt = mgr.create('My Feat!');
    expect(wt.branch).toMatch(/^shinobi-wt-my-feat-\d+-\d+$/);
    expect(wt.path).toBe(path.join(baseDir, wt.branch));
    const addCall = git.calls.find((c) => c[0] === 'worktree' && c[1] === 'add');
    expect(addCall).toEqual(['worktree', 'add', '-b', wt.branch, wt.path, 'HEAD']);
  });

  it('create lanza si git falla', () => {
    const git = mockGit(() => ({ code: 1, stderr: 'fatal: boom' }));
    const mgr = new WorktreeManager({ repoRoot: '/repo', baseDir, git });
    expect(() => mgr.create('x')).toThrow(/boom/);
  });

  it('isClean: limpio vs sucio', () => {
    const clean = new WorktreeManager({ git: mockGit(() => ({ code: 0, stdout: '' })) });
    const dirty = new WorktreeManager({ git: mockGit(() => ({ code: 0, stdout: ' M file.ts\n' })) });
    expect(clean.isClean('/wt')).toBe(true);
    expect(dirty.isClean('/wt')).toBe(false);
  });

  it('removeIfUnchanged: conserva si está sucio, elimina si está limpio', () => {
    const dirtyGit = mockGit((a) => (a[0] === 'status' ? { stdout: ' M x\n' } : { code: 0 }));
    const dirtyMgr = new WorktreeManager({ git: dirtyGit });
    expect(dirtyMgr.removeIfUnchanged('/wt')).toEqual({ removed: false, reason: 'dirty' });
    expect(dirtyGit.calls.some((c) => c[0] === 'worktree' && c[1] === 'remove')).toBe(false);

    const cleanGit = mockGit(() => ({ code: 0, stdout: '' }));
    const cleanMgr = new WorktreeManager({ git: cleanGit });
    expect(cleanMgr.removeIfUnchanged('/wt')).toEqual({ removed: true, reason: 'clean' });
    expect(cleanGit.calls.some((c) => c[0] === 'worktree' && c[1] === 'remove')).toBe(true);
  });

  it('remove pasa --force solo cuando se pide', () => {
    const git = mockGit(() => ({ code: 0 }));
    const mgr = new WorktreeManager({ repoRoot: '/repo', git });
    mgr.remove('/wt', false);
    mgr.remove('/wt', true);
    expect(git.calls).toContainEqual(['worktree', 'remove', '/wt']);
    expect(git.calls).toContainEqual(['worktree', 'remove', '/wt', '--force']);
  });
});

describe('parseWorktreeList', () => {
  it('parsea bloques porcelain (rama y detached)', () => {
    const out = parseWorktreeList(
      'worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\n' +
      'worktree /tmp/wt1\nHEAD def456\nbranch refs/heads/shinobi-wt-x\n\n' +
      'worktree /tmp/wt2\nHEAD 999\ndetached\n',
    );
    expect(out).toEqual([
      { path: '/repo', branch: 'main', head: 'abc123' },
      { path: '/tmp/wt1', branch: 'shinobi-wt-x', head: 'def456' },
      { path: '/tmp/wt2', branch: '(detached)', head: '999' },
    ]);
  });
});

// ── Integración (git REAL sobre repo temporal) ────────────────────────────

describe('WorktreeManager (integración, git real)', () => {
  let repo: string;
  let mgr: WorktreeManager;
  const originalCwd = process.cwd();

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-wt-itg-'));
    const run = (args: string[]) => {
      const r = spawnSync('git', args, { cwd: repo, encoding: 'utf-8' });
      if ((r.status ?? 1) !== 0) throw new Error(`git ${args.join(' ')} → ${r.stderr}`);
    };
    run(['init', '-q']);
    run(['config', 'user.email', 'test@shinobi.local']);
    run(['config', 'user.name', 'Shinobi Test']);
    run(['config', 'commit.gpgsign', 'false']);
    fs.writeFileSync(path.join(repo, 'README.md'), '# repo de prueba\n');
    run(['add', '-A']);
    run(['commit', '-q', '-m', 'init']);
    mgr = new WorktreeManager({ repoRoot: repo, baseDir: path.join(repo, '.wt') });
  });

  afterAll(() => {
    // Asegurar cwd restaurado y borrar el repo temporal.
    try { process.chdir(originalCwd); } catch { /* ignore */ }
    try { fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 }); } catch { /* ignore */ }
  });

  it('detecta el repo y crea un worktree con el contenido del commit', () => {
    expect(mgr.isGitRepo()).toBe(true);
    const wt = mgr.create('feat');
    expect(fs.existsSync(wt.path)).toBe(true);
    expect(fs.existsSync(path.join(wt.path, 'README.md'))).toBe(true);
    // aparece en list
    expect(mgr.list().some((w) => path.resolve(w.path) === path.resolve(wt.path))).toBe(true);
    // limpio recién creado → removeIfUnchanged lo elimina
    expect(mgr.isClean(wt.path)).toBe(true);
    expect(mgr.removeIfUnchanged(wt.path).removed).toBe(true);
    expect(fs.existsSync(wt.path)).toBe(false);
  });

  it('un worktree con cambios se conserva con removeIfUnchanged; remove --force lo borra', () => {
    const wt = mgr.create('dirty');
    fs.writeFileSync(path.join(wt.path, 'nuevo.txt'), 'cambio local\n');
    expect(mgr.isClean(wt.path)).toBe(false);
    expect(mgr.removeIfUnchanged(wt.path)).toEqual({ removed: false, reason: 'dirty' });
    expect(fs.existsSync(wt.path)).toBe(true);
    expect(mgr.remove(wt.path, true)).toBe(true);
    expect(fs.existsSync(wt.path)).toBe(false);
  });

  it('withWorktree aísla cwd+WORKSPACE_ROOT y lo restaura; descarta por defecto', async () => {
    const before = process.cwd();
    let insideCwd = '';
    let insideWsRoot = '';
    const { worktree, kept } = await withWorktree(mgr, 'scoped', async (wt) => {
      insideCwd = path.resolve(process.cwd());
      insideWsRoot = path.resolve(process.env.WORKSPACE_ROOT || '');
      fs.writeFileSync(path.join(wt.path, 'work.txt'), 'trabajo\n');
      return 'done';
    });
    // dentro: cwd y WORKSPACE_ROOT apuntaban al worktree
    expect(insideCwd).toBe(path.resolve(worktree.path));
    expect(insideWsRoot).toBe(path.resolve(worktree.path));
    // fuera: restaurado y worktree descartado (default)
    expect(process.cwd()).toBe(before);
    expect(kept).toBe(false);
    expect(fs.existsSync(worktree.path)).toBe(false);
  });

  it('withWorktree con keepIfChanged conserva el worktree si hubo cambios', async () => {
    const { worktree, kept } = await withWorktree(
      mgr, 'keep',
      async (wt) => { fs.writeFileSync(path.join(wt.path, 'a.txt'), 'x\n'); return 1; },
      { keepIfChanged: true },
    );
    expect(kept).toBe(true);
    expect(fs.existsSync(worktree.path)).toBe(true);
    // limpieza manual
    mgr.remove(worktree.path, true);
  });
});
