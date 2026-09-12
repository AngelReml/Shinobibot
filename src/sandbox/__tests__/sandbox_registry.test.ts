import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sandboxRegistry, _resetSandboxRegistry, MockBackend } from '../registry.js';
import { LocalBackend } from '../backends/local.js';
import { SSHBackend } from '../backends/ssh.js';
import { disposeE2BSandbox, E2BBackend, runE2BCommand } from '../backends/e2b.js';
import { PowerShellBackend } from '../backends/powershell.js';

beforeEach(() => {
  _resetSandboxRegistry();
  delete process.env.SHINOBI_RUN_BACKEND;
  for (const k of ['SSH_HOST', 'SSH_USER', 'SSH_KEY_PATH', 'E2B_API_KEY']) delete process.env[k];
});
afterEach(() => {
  delete process.env.SHINOBI_RUN_BACKEND;
});

describe('SandboxRegistry — defaults', () => {
  it('registra los 5 backends por defecto', () => {
    const ids = sandboxRegistry().list().map(b => b.id).sort();
    expect(ids).toEqual(['docker', 'e2b', 'local', 'powershell', 'ssh']);
  });
});

describe('LocalBackend (real exec)', () => {
  it('ejecuta un comando trivial y devuelve stdout', async () => {
    const b = new LocalBackend();
    const r = await b.run({ command: 'node -e "console.log(\'shinobi\')"', cwd: process.cwd(), timeoutMs: 5000 });
    expect(r.success).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('shinobi');
    expect(r.backend).toBe('local');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('comando que falla devuelve exitCode != 0', async () => {
    const b = new LocalBackend();
    const r = await b.run({ command: 'node -e "process.exit(7)"', cwd: process.cwd(), timeoutMs: 5000 });
    expect(r.success).toBe(false);
    expect(r.exitCode).toBe(7);
    expect(r.backend).toBe('local');
  });
});

describe('PowerShellBackend (real powershell.exe, win32)', () => {
  const itWin = process.platform === 'win32' ? it : it.skip;

  itWin('ejecuta un comando trivial y devuelve stdout', async () => {
    const b = new PowerShellBackend();
    const r = await b.run({ command: "Write-Output 'shinobi-ps'", cwd: process.cwd(), timeoutMs: 15000 });
    expect(r.success).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('shinobi-ps');
    expect(r.backend).toBe('powershell');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  itWin('comando que falla devuelve success false', async () => {
    const b = new PowerShellBackend();
    const r = await b.run({ command: 'exit 7', cwd: process.cwd(), timeoutMs: 15000 });
    expect(r.success).toBe(false);
    expect(r.backend).toBe('powershell');
  });

  it('isConfigured refleja el platform real', () => {
    const b = new PowerShellBackend();
    expect(b.isConfigured()).toBe(process.platform === 'win32');
  });
});

describe('MockBackend', () => {
  it('default: echo del comando', async () => {
    const b = new MockBackend();
    const r = await b.run({ command: 'foo bar', cwd: '/x', timeoutMs: 1000 });
    expect(r.success).toBe(true);
    expect(r.stdout).toContain('foo bar');
    expect(r.backend).toBe('mock');
  });

  it('scriptedOutput personalizado', async () => {
    const b = new MockBackend({ scriptedOutput: () => ({ stdout: 'hi', stderr: '', exitCode: 0 }) });
    const r = await b.run({ command: 'x', cwd: '/x', timeoutMs: 1000 });
    expect(r.stdout).toBe('hi');
  });

  it('exitCode != 0 → success false', async () => {
    const b = new MockBackend({ scriptedOutput: () => ({ stdout: '', stderr: 'oops', exitCode: 3 }) });
    const r = await b.run({ command: 'x', cwd: '/x', timeoutMs: 1000 });
    expect(r.success).toBe(false);
    expect(r.exitCode).toBe(3);
  });

  it('fakeLatencyMs simula latencia', async () => {
    const b = new MockBackend({ fakeLatencyMs: 50 });
    const t0 = Date.now();
    await b.run({ command: 'x', cwd: '/x', timeoutMs: 1000 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(45);
  });
});

describe('Remote backends — config detection', () => {
  it('SSHBackend: detecta envs incrementales', () => {
    const b = new SSHBackend();
    expect(b.isConfigured()).toBe(false);
    process.env.SSH_HOST = 'x';
    process.env.SSH_USER = 'y';
    expect(b.isConfigured()).toBe(false);
    process.env.SSH_KEY_PATH = '/key';
    expect(b.isConfigured()).toBe(true);
  });
  it('E2BBackend toggle por env', () => {
    const e = new E2BBackend();
    expect(e.isConfigured()).toBe(false);
    process.env.E2B_API_KEY = 'x';
    expect(e.isConfigured()).toBe(true);
  });
});

describe('E2BBackend — SDK compatibility helpers', () => {
  it('usa commands.run cuando el SDK moderno lo expone', async () => {
    const calls: any[] = [];
    const sandbox = {
      commands: {
        run: async (...args: any[]) => {
          calls.push(args);
          return { exitCode: 0, stdout: 'ok', stderr: '' };
        },
      },
    };

    const result = await runE2BCommand(sandbox, { command: 'echo ok', cwd: '/work', timeoutMs: 1234 });

    expect(result.stdout).toBe('ok');
    expect(calls).toEqual([['echo ok', { cwd: '/work', timeoutMs: 1234 }]]);
  });

  it('mantiene fallback legacy a process.start().wait()', async () => {
    const calls: any[] = [];
    const sandbox = {
      process: {
        start: async (...args: any[]) => {
          calls.push(args);
          return {
            wait: async (opts: any) => ({ exitCode: 0, stdout: `wait:${opts.timeoutMs}`, stderr: '' }),
          };
        },
      },
    };

    const result = await runE2BCommand(sandbox, { command: 'pwd', cwd: '/repo', timeoutMs: 99 });

    expect(result.stdout).toBe('wait:99');
    expect(calls).toEqual([[{ cmd: 'pwd', cwd: '/repo' }]]);
  });

  it('prefiere kill al liberar sandboxes y conserva close como fallback', async () => {
    const events: string[] = [];

    await disposeE2BSandbox({ kill: async () => events.push('kill'), close: async () => events.push('close') });
    await disposeE2BSandbox({ close: async () => events.push('legacy-close') });

    expect(events).toEqual(['kill', 'legacy-close']);
  });
});

describe('Remote backends — run() sin config devuelve error claro', () => {
  it('SSH sin envs devuelve stderr explicando qué falta', async () => {
    const r = await new SSHBackend().run({ command: 'echo x', cwd: '/x', timeoutMs: 5000 });
    expect(r.success).toBe(false);
    expect(r.stderr).toMatch(/SSH_HOST|SSH_USER|SSH_KEY_PATH/);
    expect(r.exitCode).toBe(127);
  });
  it('E2B sin env key devuelve mensaje pidiendo dashboard', async () => {
    const r = await new E2BBackend().run({ command: 'x', cwd: '/x', timeoutMs: 5000 });
    expect(r.success).toBe(false);
    expect(r.stderr).toMatch(/E2B_API_KEY/);
  });
});
