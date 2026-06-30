// src/agents/__tests__/team_depth.test.ts
// Tests de spawn_depth para el motor team.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTeam } from '../team.js';
import { WorktreeManager } from '../worktree.js';
import { runWithSpawnDepth } from '../spawn_depth.js';
import type { LLMInvoker } from '../agent_loop.js';

const envelope = (c: string) => JSON.stringify({ content: c });
const mockOk: LLMInvoker = async () => ({ success: true, output: envelope('hecho'), error: '' });

let repo: string;
let mgr: WorktreeManager;

beforeAll(() => {
  process.env.SHINOBI_AUDIT_DISABLED = '1';
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-team-depth-'));
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
  try { fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 }); } catch { /* */ }
});

describe('runTeam — spawn_depth', () => {
  it('tareas en paralelo sin exceder profundidad (happy path)', async () => {
    const result = await runTeam({
      tasks: [{ task: 'A', label: 'member-A' }, { task: 'B', label: 'member-B' }],
      manager: mgr,
      invokeLLM: mockOk,
      discardWorktrees: true,
    });
    expect(result.total).toBe(2);
  });

  it('lanza si profundidad actual + 1 >= maxDepth', async () => {
    process.env.SHINOBI_MAX_SPAWN_DEPTH = '2';
    try {
      await expect(
        runWithSpawnDepth(1, () =>
          runTeam({
            tasks: [{ task: 'A', label: 'member-depth' }],
            manager: mgr,
            invokeLLM: mockOk,
            discardWorktrees: true,
          })
        )
      ).rejects.toThrow(/profundidad máxima/i);
    } finally {
      delete process.env.SHINOBI_MAX_SPAWN_DEPTH;
    }
  });
});
