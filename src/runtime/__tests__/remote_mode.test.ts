import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  parseRemoteUrl,
  generateArtifacts,
  writeArtifacts,
  healthCheck,
  renderInstructions,
} from '../remote_mode.js';

let work: string;
beforeEach(() => { work = mkdtempSync(join(tmpdir(), 'shinobi-rmt-')); });
afterEach(() => { try { if (existsSync(work)) rmSync(work, { recursive: true, force: true }); } catch {} });

describe('parseRemoteUrl', () => {
  it('ssh://user@host:port', () => {
    const t = parseRemoteUrl('ssh://root@1.2.3.4:2222');
    expect(t.kind).toBe('ssh');
    expect(t.user).toBe('root');
    expect(t.host).toBe('1.2.3.4');
    expect(t.port).toBe(2222);
  });
  it('ssh://host sin user → root', () => {
    const t = parseRemoteUrl('ssh://example.com');
    expect(t.kind).toBe('ssh');
    expect(t.user).toBe('root');
    expect(t.port).toBe(22);
  });
  it('https://host:port', () => {
    const t = parseRemoteUrl('https://kernel.example.com:8443/x');
    expect(t.kind).toBe('https');
    expect(t.host).toBe('kernel.example.com');
    expect(t.port).toBe(8443);
    expect(t.url).toContain('/x');
  });
  it('shorthand user@host', () => {
    const t = parseRemoteUrl('admin@10.0.0.1');
    expect(t.kind).toBe('ssh');
    expect(t.user).toBe('admin');
    expect(t.host).toBe('10.0.0.1');
  });
  it('shorthand host solo', () => {
    const t = parseRemoteUrl('vps.example.com');
    expect(t.kind).toBe('ssh');
    expect(t.user).toBe('root');
  });
  it('vacío lanza', () => {
    expect(() => parseRemoteUrl('')).toThrow();
  });
  it('mal formato lanza', () => {
    expect(() => parseRemoteUrl('http://')).toThrow();
  });
});

describe('generateArtifacts', () => {
  const target = parseRemoteUrl('ssh://root@1.2.3.4');

  it('produce 4 artefactos no vacíos', () => {
    const a = generateArtifacts(target);
    expect(a.dockerfile.length).toBeGreaterThan(0);
    expect(a.composeYml.length).toBeGreaterThan(0);
    expect(a.startScript.length).toBeGreaterThan(0);
    expect(a.envTemplate.length).toBeGreaterThan(0);
  });

  it('dockerfile usa node:22-bookworm-slim + EXPOSE 3333', () => {
    const a = generateArtifacts(target);
    expect(a.dockerfile).toContain('FROM node:22-bookworm-slim');
    expect(a.dockerfile).toContain('EXPOSE 3333');
  });

  it('compose usa bind 127.0.0.1 (no expuesto a internet)', () => {
    const a = generateArtifacts(target);
    expect(a.composeYml).toContain('127.0.0.1:3333:3333');
  });

  it('startScript include rsync + docker compose + ssh tunnel', () => {
    const a = generateArtifacts(target);
    expect(a.startScript).toContain('rsync');
    expect(a.startScript).toContain('docker compose up');
    expect(a.startScript).toContain('-L');
    expect(a.startScript).toContain('root@1.2.3.4');
  });

  it('puerto custom respetado', () => {
    const a = generateArtifacts(target, { port: 9000 });
    expect(a.dockerfile).toContain('EXPOSE 9000');
    expect(a.composeYml).toContain('127.0.0.1:9000:9000');
  });

  it('envTemplate incluye SHINOBI_NOTIFY_ENABLED=0 (silencio default)', () => {
    const a = generateArtifacts(target);
    expect(a.envTemplate).toContain('SHINOBI_NOTIFY_ENABLED=0');
  });
});

describe('writeArtifacts', () => {
  it('escribe los 4 archivos a outDir', () => {
    const target = parseRemoteUrl('ssh://root@10.0.0.1');
    const a = generateArtifacts(target);
    const paths = writeArtifacts(work, a);
    expect(paths).toHaveLength(4);
    for (const p of paths) {
      expect(existsSync(p)).toBe(true);
      expect(readFileSync(p, 'utf-8').length).toBeGreaterThan(0);
    }
    // Nombres conocidos.
    const names = paths.map(p => p.split(/[\\/]/).pop());
    expect(names).toContain('Dockerfile.remote');
    expect(names).toContain('docker-compose.remote.yml');
    expect(names).toContain('shinobi-remote-deploy.sh');
    expect(names).toContain('.env.remote.template');
  });
});

describe('healthCheck', () => {
  it('fetch mock ok → ok=true con latencia', async () => {
    const r = await healthCheck({
      url: 'http://x',
      fetchImpl: async () => ({ ok: true, status: 200 }),
    });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });
  it('fetch mock 500 → ok=false con error HTTP', async () => {
    const r = await healthCheck({
      url: 'http://x',
      fetchImpl: async () => ({ ok: false, status: 500 }),
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(500);
    expect(r.error).toContain('500');
  });
  it('fetch throw → ok=false con error message', async () => {
    const r = await healthCheck({
      url: 'http://x',
      fetchImpl: async () => { throw new Error('connection refused'); },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('connection refused');
  });
  it('timeout dispara error sin esperar respuesta', async () => {
    const r = await healthCheck({
      url: 'http://x',
      timeoutMs: 50,
      fetchImpl: () => new Promise(() => { /* never resolves */ }),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timeout/);
  }, 1000);
});

describe('renderInstructions', () => {
  it('produce lista no vacía con sshHost y archivos', () => {
    const target = parseRemoteUrl('ssh://operator@vps.example.com');
    const a = generateArtifacts(target);
    const paths = writeArtifacts(work, a);
    const lines = renderInstructions(target, paths);
    expect(lines.length).toBeGreaterThan(5);
    const joined = lines.join('\n');
    expect(joined).toContain('operator@vps.example.com');
    expect(joined).toContain('shinobi-remote-deploy.sh');
    expect(joined).toContain('docker compose');
    expect(joined).toContain('túnel SSH');
  });
});
