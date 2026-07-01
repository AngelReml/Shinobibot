// F1.1 — cwd fuera del workspace (incluyendo symlinks) se rechaza. Reusa
// checkSandbox de run_command.ts (mismo patrón que CRIT-03), aquí se
// confirma que LocalBackend lo aplica también cuando se invoca directo
// (sin pasar por run_command.ts).
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LocalBackend } from '../local.js';
import { runInContext } from '../../../agents/exec_context.js';

describe('F1.1 — LocalBackend rechaza cwd fuera del workspace', () => {
  let workspace: string;
  let outside: string;

  afterEach(() => {
    try { fs.rmSync(workspace, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(outside, { recursive: true, force: true }); } catch {}
  });

  it('cwd literal fuera del workspace se rechaza', async () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-ws-'));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-outside-'));
    const result = await runInContext({ cwd: workspace, workspaceRoot: workspace }, async () => {
      return new LocalBackend().run({ command: 'echo hi', cwd: outside, timeoutMs: 5000 });
    });
    expect(result.success).toBe(false);
    expect(result.stderr).toMatch(/workspace/i);
  });

  it('cwd dentro del workspace se acepta', async () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-ws-'));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-unused-'));
    const result = await runInContext({ cwd: workspace, workspaceRoot: workspace }, async () => {
      return new LocalBackend().run({ command: 'echo hi', cwd: workspace, timeoutMs: 5000 });
    });
    expect(result.success).toBe(true);
  });
});
