import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WhatsAppAdapter } from '../adapters/whatsapp_adapter.js';
import { SignalAdapter } from '../adapters/signal_adapter.js';
import { MatrixAdapter } from '../adapters/matrix_adapter.js';
import { TeamsAdapter } from '../adapters/teams_adapter.js';
import { WebhookAdapter } from '../adapters/webhook_adapter.js';

const ENV_KEYS = [
  'SHINOBI_WHATSAPP_ENABLED', 'WHATSAPP_ALLOWED_CHATS',
  'SIGNAL_PHONE_NUMBER', 'SIGNAL_CLI_BIN', 'SIGNAL_ALLOWED_NUMBERS',
  'MATRIX_HOMESERVER_URL', 'MATRIX_ACCESS_TOKEN', 'MATRIX_BOT_USER_ID', 'MATRIX_ALLOWED_ROOMS',
  'TEAMS_APP_ID', 'TEAMS_APP_PASSWORD', 'TEAMS_LISTEN_PORT',
  'SHINOBI_WEBHOOK_ENABLED', 'WEBHOOK_LISTEN_PORT', 'WEBHOOK_SHARED_SECRET',
];

beforeEach(() => { for (const k of ENV_KEYS) delete process.env[k]; });
afterEach(() => { for (const k of ENV_KEYS) delete process.env[k]; });

// ── WhatsApp ──
describe('WhatsAppAdapter', () => {
  it('isConfigured=false sin env flag', () => {
    expect(new WhatsAppAdapter().isConfigured()).toBe(false);
  });
  it('isConfigured=true con flag', () => {
    process.env.SHINOBI_WHATSAPP_ENABLED = '1';
    expect(new WhatsAppAdapter().isConfigured()).toBe(true);
  });
  it('start falla sin config', async () => {
    await expect(new WhatsAppAdapter().start(async () => null)).rejects.toThrow(/SHINOBI_WHATSAPP_ENABLED/);
  });
  it('start falla si whatsapp-web.js no instalado (sin dep)', async () => {
    process.env.SHINOBI_WHATSAPP_ENABLED = '1';
    await expect(new WhatsAppAdapter().start(async () => null)).rejects.toThrow(/whatsapp-web\.js/);
  });
  it('requiredEnvVars expuesto', () => {
    expect(new WhatsAppAdapter().requiredEnvVars()).toContain('SHINOBI_WHATSAPP_ENABLED');
  });
  it('status inicial', () => {
    const s = new WhatsAppAdapter().status();
    expect(s.running).toBe(false);
    expect(s.receivedCount).toBe(0);
  });
});

// ── Signal ──
import { Readable, Writable } from 'stream';
import { EventEmitter } from 'events';

class FakeSignalProc extends EventEmitter {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  killed = false;
  constructor() {
    super();
    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });
    this.stdin = new Writable({ write(_c, _e, cb) { cb(); } });
  }
  kill() { this.killed = true; this.emit('exit'); return true; }
  emitLine(obj: any) {
    this.stdout.push(JSON.stringify(obj) + '\n');
  }
}

class TestSignalAdapter extends SignalAdapter {
  public fake = new FakeSignalProc();
  protected spawnDaemon(): any { return this.fake as any; }
}

describe('SignalAdapter', () => {
  it('isConfigured falla sin phone', () => {
    expect(new SignalAdapter().isConfigured()).toBe(false);
  });
  it('start falla sin phone', async () => {
    await expect(new SignalAdapter().start(async () => null)).rejects.toThrow(/SIGNAL_PHONE_NUMBER/);
  });
  it('procesa mensaje entrante y responde', async () => {
    process.env.SIGNAL_PHONE_NUMBER = '+1234567890';
    const a = new TestSignalAdapter();
    const received: string[] = [];
    await a.start(async (m) => {
      received.push(m.text);
      return { text: 'echo: ' + m.text };
    });
    a.fake.emitLine({
      method: 'receive',
      params: {
        envelope: {
          source: '+5550001',
          timestamp: Date.now(),
          dataMessage: { message: 'hola' },
        },
      },
    });
    await new Promise(r => setTimeout(r, 20));
    expect(received).toEqual(['hola']);
    expect(a.status().receivedCount).toBe(1);
  });
  it('respeta whitelist SIGNAL_ALLOWED_NUMBERS', async () => {
    process.env.SIGNAL_PHONE_NUMBER = '+1234567890';
    process.env.SIGNAL_ALLOWED_NUMBERS = '+5550001';
    const a = new TestSignalAdapter();
    const received: string[] = [];
    await a.start(async (m) => { received.push(m.text); return null; });
    a.fake.emitLine({ method: 'receive', params: { envelope: { source: '+5550999', timestamp: 0, dataMessage: { message: 'spam' } } } });
    a.fake.emitLine({ method: 'receive', params: { envelope: { source: '+5550001', timestamp: 0, dataMessage: { message: 'ok' } } } });
    await new Promise(r => setTimeout(r, 20));
    expect(received).toEqual(['ok']);
  });
  it('stop kills proc', async () => {
    process.env.SIGNAL_PHONE_NUMBER = '+1';
    const a = new TestSignalAdapter();
    await a.start(async () => null);
    await a.stop();
    expect(a.fake.killed).toBe(true);
  });
});

// ── Matrix ──
describe('MatrixAdapter', () => {
  it('isConfigured falla sin las 3 vars', () => {
    expect(new MatrixAdapter().isConfigured()).toBe(false);
    process.env.MATRIX_HOMESERVER_URL = 'https://x';
    process.env.MATRIX_ACCESS_TOKEN = 'tok';
    expect(new MatrixAdapter().isConfigured()).toBe(false); // falta bot user id
    process.env.MATRIX_BOT_USER_ID = '@b:x';
    expect(new MatrixAdapter().isConfigured()).toBe(true);
  });
  it('start falla sin config', async () => {
    await expect(new MatrixAdapter().start(async () => null)).rejects.toThrow(/MATRIX/);
  });
  it('requiredEnvVars lista 3', () => {
    expect(new MatrixAdapter().requiredEnvVars().length).toBe(3);
  });
  it('start falla si matrix-bot-sdk no instalado', async () => {
    process.env.MATRIX_HOMESERVER_URL = 'https://x';
    process.env.MATRIX_ACCESS_TOKEN = 'tok';
    process.env.MATRIX_BOT_USER_ID = '@b:x';
    await expect(new MatrixAdapter().start(async () => null)).rejects.toThrow(/matrix-bot-sdk/);
  });
});

// ── Teams ──
describe('TeamsAdapter', () => {
  it('isConfigured falla sin app id/pass', () => {
    expect(new TeamsAdapter().isConfigured()).toBe(false);
  });
  it('start falla si botbuilder no instalado', async () => {
    process.env.TEAMS_APP_ID = 'app';
    process.env.TEAMS_APP_PASSWORD = 'pwd';
    await expect(new TeamsAdapter().start(async () => null)).rejects.toThrow(/botbuilder/);
  });
  it('send proactivo es no-op (no rompe channelRegistry.send)', async () => {
    const a = new TeamsAdapter();
    // send() ya no lanza: un adapter registrado no debe romper el registry.
    await expect(a.send({ channelId: 'teams', conversationId: 'x' }, { text: 'hi' }))
      .resolves.toBeUndefined();
  });
});

// ── Webhook ──
import { request as httpRequest } from 'http';

function httpPost(port: number, path: string, body: any, auth?: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const req = httpRequest({
      host: '127.0.0.1', port, path, method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        ...(auth ? { authorization: auth } : {}),
      },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => buf += c);
      res.on('end', () => {
        let parsed: any = buf;
        try { parsed = JSON.parse(buf); } catch {}
        resolve({ status: res.statusCode || 0, body: parsed });
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

describe('WebhookAdapter', () => {
  it('isConfigured con SHINOBI_WEBHOOK_ENABLED=1', () => {
    expect(new WebhookAdapter().isConfigured()).toBe(false);
    process.env.SHINOBI_WEBHOOK_ENABLED = '1';
    expect(new WebhookAdapter().isConfigured()).toBe(true);
  });

  it('start falla sin enable flag', async () => {
    await expect(new WebhookAdapter().start(async () => null)).rejects.toThrow(/WEBHOOK_ENABLED/);
  });

  it('procesa POST con body válido', async () => {
    process.env.SHINOBI_WEBHOOK_ENABLED = '1';
    process.env.WEBHOOK_LISTEN_PORT = '13901';
    const a = new WebhookAdapter();
    await a.start(async (msg) => ({ text: 'eco: ' + msg.text }));
    try {
      const r = await httpPost(13901, '/webhook/incoming', { text: 'hola', userId: 'u1' });
      expect(r.status).toBe(200);
      expect(r.body.text).toBe('eco: hola');
      expect(a.status().receivedCount).toBe(1);
      expect(a.status().sentCount).toBe(1);
    } finally { await a.stop(); }
  });

  it('rechaza JSON inválido con 400', async () => {
    process.env.SHINOBI_WEBHOOK_ENABLED = '1';
    process.env.WEBHOOK_LISTEN_PORT = '13902';
    const a = new WebhookAdapter();
    await a.start(async () => ({ text: 'x' }));
    try {
      const r = await httpPost(13902, '/webhook/incoming', 'not-json');
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('invalid_json');
    } finally { await a.stop(); }
  });

  it('rechaza body sin text con 400', async () => {
    process.env.SHINOBI_WEBHOOK_ENABLED = '1';
    process.env.WEBHOOK_LISTEN_PORT = '13903';
    const a = new WebhookAdapter();
    await a.start(async () => ({ text: 'x' }));
    try {
      const r = await httpPost(13903, '/webhook/incoming', { userId: 'u' });
      expect(r.status).toBe(400);
    } finally { await a.stop(); }
  });

  it('rechaza path desconocido con 404', async () => {
    process.env.SHINOBI_WEBHOOK_ENABLED = '1';
    process.env.WEBHOOK_LISTEN_PORT = '13904';
    const a = new WebhookAdapter();
    await a.start(async () => null);
    try {
      const r = await httpPost(13904, '/other', { text: 'x' });
      expect(r.status).toBe(404);
    } finally { await a.stop(); }
  });

  it('exige Bearer token si WEBHOOK_SHARED_SECRET', async () => {
    process.env.SHINOBI_WEBHOOK_ENABLED = '1';
    process.env.WEBHOOK_LISTEN_PORT = '13905';
    process.env.WEBHOOK_SHARED_SECRET = 'topsecret';
    const a = new WebhookAdapter();
    await a.start(async (m) => ({ text: 'ok ' + m.text }));
    try {
      const noAuth = await httpPost(13905, '/webhook/incoming', { text: 'x' });
      expect(noAuth.status).toBe(401);
      const bad = await httpPost(13905, '/webhook/incoming', { text: 'x' }, 'Bearer wrong');
      expect(bad.status).toBe(401);
      const ok = await httpPost(13905, '/webhook/incoming', { text: 'x' }, 'Bearer topsecret');
      expect(ok.status).toBe(200);
    } finally { await a.stop(); }
  });

  it('send síncrono es no-op (no rompe channelRegistry.send)', async () => {
    const a = new WebhookAdapter();
    // send() ya no lanza: un adapter registrado no debe romper el registry.
    await expect(a.send({ channelId: 'webhook', conversationId: 'x' }, { text: 't' }))
      .resolves.toBeUndefined();
  });
});
