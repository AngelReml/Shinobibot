import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { BrowserSandboxManager } from '../manager.js';

let work: string;
let composePath: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'shinobi-bsbox-'));
  composePath = join(work, 'docker-compose.sandbox-browser.yml');
  writeFileSync(composePath, 'services:\n  shinobi-sandbox-browser: {}', 'utf-8');
});
afterEach(() => { try { if (existsSync(work)) rmSync(work, { recursive: true, force: true }); } catch {} });

class FakeChild extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
  constructor(public stdoutData: string = '', public stderrData: string = '', public exitCode: number = 0) {
    super();
    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });
    setImmediate(() => {
      if (stdoutData) this.stdout.push(stdoutData);
      this.stdout.push(null);
      if (stderrData) this.stderr.push(stderrData);
      this.stderr.push(null);
      this.emit('exit', exitCode);
    });
  }
}

function fakeSpawn(out = '', err = '', code = 0): any {
  return ((..._a: any[]) => new FakeChild(out, err, code)) as any;
}

function mockFetchOk(status: number = 200): any {
  return async () => ({ ok: status >= 200 && status < 300, status });
}

describe('BrowserSandboxManager URLs y compose', () => {
  it('vncUrl y cdpUrl coherentes con puertos default', () => {
    const m = new BrowserSandboxManager({ composePath });
    expect(m.vncUrl()).toBe('http://127.0.0.1:6080/vnc.html');
    expect(m.cdpUrl()).toBe('http://127.0.0.1:9222');
  });

  it('puertos custom', () => {
    const m = new BrowserSandboxManager({ composePath, novncPort: 7081, cdpPort: 9333 });
    expect(m.vncUrl()).toBe('http://127.0.0.1:7081/vnc.html');
    expect(m.cdpUrl()).toBe('http://127.0.0.1:9333');
  });

  it('isComposeAvailable true cuando file existe', () => {
    expect(new BrowserSandboxManager({ composePath }).isComposeAvailable()).toBe(true);
  });

  it('isComposeAvailable false con path inválido', () => {
    expect(new BrowserSandboxManager({ composePath: join(work, 'no.yml') }).isComposeAvailable()).toBe(false);
  });

  it('up() throw si compose no existe', async () => {
    const m = new BrowserSandboxManager({ composePath: join(work, 'no.yml') });
    await expect(m.up()).rejects.toThrow(/no encontrado/);
  });
});

describe('docker spawn mocks', () => {
  it('up() ejecuta docker compose -f ... up -d', async () => {
    let captured: any = null;
    const m = new BrowserSandboxManager({
      composePath,
      spawnImpl: ((bin: string, args: string[]) => {
        captured = { bin, args };
        return new FakeChild('Container started\n', '', 0);
      }) as any,
    });
    const r = await m.up();
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Container started');
    expect(captured.args).toContain('up');
    expect(captured.args).toContain('-d');
    expect(captured.args).toContain('-f');
    expect(captured.args).toContain(composePath);
  });

  it('up({build:true}) añade --build', async () => {
    let captured: any = null;
    const m = new BrowserSandboxManager({
      composePath,
      spawnImpl: ((bin: string, args: string[]) => {
        captured = args;
        return new FakeChild('', '', 0);
      }) as any,
    });
    await m.up({ build: true });
    expect(captured).toContain('--build');
  });

  it('down() ejecuta docker compose -f ... down', async () => {
    let captured: any = null;
    const m = new BrowserSandboxManager({
      composePath,
      spawnImpl: ((bin: string, args: string[]) => {
        captured = args;
        return new FakeChild('', '', 0);
      }) as any,
    });
    await m.down();
    expect(captured).toContain('down');
  });

  it('status() captura output', async () => {
    const m = new BrowserSandboxManager({
      composePath,
      spawnImpl: fakeSpawn('NAME                       STATUS\nshinobi-sandbox-browser   running\n'),
    });
    const r = await m.status();
    expect(r.stdout).toContain('running');
  });

  it('docker error → rejection', async () => {
    const m = new BrowserSandboxManager({
      composePath,
      spawnImpl: ((..._a: any[]) => {
        const c = new EventEmitter() as any;
        c.stdout = new Readable({ read() {} });
        c.stderr = new Readable({ read() {} });
        setImmediate(() => c.emit('error', new Error('docker no instalado')));
        return c;
      }) as any,
    });
    await expect(m.up()).rejects.toThrow(/docker no instalado/);
  });
});

describe('healthCheck', () => {
  it('todo OK → ok=true', async () => {
    const m = new BrowserSandboxManager({
      composePath,
      fetchImpl: mockFetchOk(200),
    });
    const h = await m.healthCheck();
    expect(h.ok).toBe(true);
    expect(h.novncOk).toBe(true);
    expect(h.cdpOk).toBe(true);
    expect(h.errors).toEqual([]);
  });

  it('novnc 500 → ok=false', async () => {
    const m = new BrowserSandboxManager({
      composePath,
      fetchImpl: (async (url: string) => {
        if (url.includes(':6080')) return { ok: false, status: 500 };
        return { ok: true, status: 200 };
      }) as any,
    });
    const h = await m.healthCheck();
    expect(h.ok).toBe(false);
    expect(h.novncOk).toBe(false);
    expect(h.cdpOk).toBe(true);
  });

  it('throw en fetch se reporta como error', async () => {
    const m = new BrowserSandboxManager({
      composePath,
      fetchImpl: (async () => { throw new Error('ECONNREFUSED'); }) as any,
    });
    const h = await m.healthCheck();
    expect(h.ok).toBe(false);
    expect(h.errors.length).toBe(2);
    expect(h.errors[0]).toContain('ECONNREFUSED');
  });

  it('timeout configurable', async () => {
    const m = new BrowserSandboxManager({
      composePath,
      fetchImpl: ((_url: string, init?: any) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('AbortError')));
      })) as any,
    });
    const h = await m.healthCheck({ timeoutMs: 50 });
    expect(h.ok).toBe(false);
    expect(h.errors.length).toBe(2);
  });
});
