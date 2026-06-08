// src/tools/__tests__/run_team.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import runTeamTool, { __setTeamInvokerForTest, __setTeamManagerForTest } from '../run_team.js';
import '../write_file.js';
import { WorktreeManager } from '../../agents/worktree.js';
import type { LLMInvoker } from '../../agents/agent_loop.js';

const envelope = (c: string) => JSON.stringify({ content: c });
const writer: LLMInvoker = async (p: any) => {
  const msgs = p?.messages ?? [];
  if (msgs.some((m: any) => m.role === 'tool')) return { success: true, output: envelope('hecho'), error: '' };
  return { success: true, output: JSON.stringify({ content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'out.txt', content: 'x' }) } }] }), error: '' };
};

describe('run_team (tool)', () => {
  let repo: string;
  const originalCwd = process.cwd();

  beforeAll(() => {
    process.env.SHINOBI_AUDIT_DISABLED = '1';
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-runteam-'));
    const run = (a: string[]) => { const r = spawnSync('git', a, { cwd: repo, encoding: 'utf-8' }); if ((r.status ?? 1) !== 0) throw new Error(r.stderr); };
    run(['init', '-q']); run(['config', 'user.email', 't@t']); run(['config', 'user.name', 'T']); run(['config', 'commit.gpgsign', 'false']);
    fs.writeFileSync(path.join(repo, 'README.md'), '# r\n'); run(['add', '-A']); run(['commit', '-q', '-m', 'i']);
    __setTeamManagerForTest(new WorktreeManager({ repoRoot: repo, baseDir: path.join(repo, '.wt') }));
    __setTeamInvokerForTest(writer);
  });
  afterAll(() => {
    delete process.env.SHINOBI_AUDIT_DISABLED;
    __setTeamManagerForTest(null); __setTeamInvokerForTest(null);
    try { process.chdir(originalCwd); } catch { /* */ }
    try { fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 }); } catch { /* */ }
  });
  afterEach(() => { delete process.env.SHINOBI_SPAWN_DEPTH; });

  it('lanza el equipo, deja ramas a fusionar y restaura la profundidad', async () => {
    const res = await runTeamTool.execute({ tasks: [{ task: 'haz algo', tools: ['write_file'] }] });
    expect(res.success).toBe(true);
    expect(res.output).toMatch(/1\/1 OK/);
    expect(res.output).toMatch(/Ramas a fusionar|rama/);
    expect(process.env.SHINOBI_SPAWN_DEPTH).toBeUndefined();
  });

  it('falla limpio sin tareas', async () => {
    const res = await runTeamTool.execute({ tasks: [] });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/tarea/);
  });

  it('aborta si se alcanzó la profundidad de spawn', async () => {
    process.env.SHINOBI_SPAWN_DEPTH = '3';
    const res = await runTeamTool.execute({ tasks: [{ task: 'x' }] });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/profundidad/i);
  });
});
