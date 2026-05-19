import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sandboxRegistry, _resetSandboxRegistry, MockBackend } from '../registry.js';
import { LocalBackend } from '../backends/local.js';
import { SSHBackend } from '../backends/ssh.js';
import { E2BBackend } from '../backends/e2b.js';

beforeEach(() => {
  _resetSandboxRegistry();
  delete process.env.SHINOBI_RUN_BACKEND;
  for (const k of ['SSH_HOST', 'SSH_USER', 'SSH_KEY_PATH', 'E2B_API_KEY']) delete process.env[k];
});
afterEach(() => {
  delete process.env.SHINOBI_RUN_BACKEND;
});

describe('SandboxRegistry — defaults', () => {
  it('registra los 4 backends por defecto', () => {
    const ids = sandboxRegistry().list().map(b => b.id).sort();
    expect(ids).toEqual(['docker', 'e2b', 'local', 'ssh']);
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
