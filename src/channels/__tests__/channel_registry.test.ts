import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { channelRegistry, _resetChannelRegistry } from '../channel_registry.js';
import { LoopbackAdapter } from '../adapters/loopback_adapter.js';
import { DiscordAdapter } from '../adapters/discord_adapter.js';
import { SlackAdapter } from '../adapters/slack_adapter.js';
import { EmailAdapter } from '../adapters/email_adapter.js';

beforeEach(() => {
  _resetChannelRegistry();
});
afterEach(async () => {
  await channelRegistry().shutdown().catch(() => {});
  _resetChannelRegistry();
});

describe('ChannelRegistry — registration', () => {
  it('register + get + list', () => {
    const r = channelRegistry();
    const a = new LoopbackAdapter();
    r.register(a);
    expect(r.get('loopback')).toBe(a);
    expect(r.list()).toHaveLength(1);
  });

  it('rejects duplicate registration', () => {
    const r = channelRegistry();
    r.register(new LoopbackAdapter());
    expect(() => r.register(new LoopbackAdapter())).toThrow(/ya está registrado/);
  });

  it('reset() clears the registry', () => {
    const r = channelRegistry();
    r.register(new LoopbackAdapter());
    r.reset();
    expect(r.list()).toEqual([]);
  });
});

describe('ChannelRegistry — start / handler', () => {
  it('start() throws if no handler bound', async () => {
    const r = channelRegistry();
    r.register(new LoopbackAdapter());
    await expect(r.start()).rejects.toThrow(/bindHandler/);
  });

  it('start() returns started + skipped lists', async () => {
    const r = channelRegistry();
    r.register(new LoopbackAdapter());                  // configured
    // Simulamos otro canal no configurado (Discord sin token).
    delete process.env.DISCORD_BOT_TOKEN;
    r.register(new DiscordAdapter());
    r.bindHandler(async () => null);
    const result = await r.start();
    expect(result.started).toContain('loopback');
    expect(result.skipped).toContain('discord');
    expect(result.errors).toEqual([]);
  });

  it('summary() lista configured + running flags', () => {
    const r = channelRegistry();
    r.register(new LoopbackAdapter());
    const s = r.summary();
    expect(s[0]).toMatchObject({ id: 'loopback', configured: true, running: false });
  });
});

describe('LoopbackAdapter — simulateIncoming → handler → send', () => {
  it('E2E roundtrip', async () => {
    const r = channelRegistry();
    const a = new LoopbackAdapter();
    r.register(a);
    r.bindHandler(async (msg) => ({ text: `eco: ${msg.text}` }));
    await r.start();
    const reply = await a.simulateIncoming({ text: 'hola', userId: 'u1' });
    expect(reply).toEqual({ text: 'eco: hola' });
    expect(a.peekOutbox()).toHaveLength(1);
    expect(a.peekOutbox()[0].msg.text).toBe('eco: hola');
    expect(a.peekOutbox()[0].target.userId).toBe('u1');
  });

  it('handler returning null produces no outbox entry', async () => {
    const r = channelRegistry();
    const a = new LoopbackAdapter();
    r.register(a);
    r.bindHandler(async () => null);
    await r.start();
    const reply = await a.simulateIncoming({ text: 'silencio' });
    expect(reply).toBeNull();
    expect(a.peekOutbox()).toEqual([]);
  });

  it('counters: receivedCount and sentCount', async () => {
    const r = channelRegistry();
    const a = new LoopbackAdapter();
    r.register(a);
    r.bindHandler(async () => ({ text: 'pong' }));
    await r.start();
    await a.simulateIncoming({ text: 'ping 1' });
    await a.simulateIncoming({ text: 'ping 2' });
    await a.simulateIncoming({ text: 'ping 3' });
    expect(a.status().receivedCount).toBe(3);
    expect(a.status().sentCount).toBe(3);
  });

  it('handler exception is captured in lastError', async () => {
    const r = channelRegistry();
    const a = new LoopbackAdapter();
    r.register(a);
    r.bindHandler(async () => { throw new Error('boom'); });
    await r.start();
    await expect(a.simulateIncoming({ text: 'x' })).rejects.toThrow('boom');
    expect(a.status().lastError).toContain('boom');
  });

  it('drainOutbox empties the outbox', async () => {
    const r = channelRegistry();
    const a = new LoopbackAdapter();
    r.register(a);
    r.bindHandler(async () => ({ text: 'r' }));
    await r.start();
    await a.simulateIncoming({ text: '1' });
    expect(a.drainOutbox()).toHaveLength(1);
    expect(a.peekOutbox()).toEqual([]);
  });
});

describe('ChannelRegistry — send proactivo', () => {
  it('send() delega al adaptador correcto', async () => {
    const r = channelRegistry();
    const a = new LoopbackAdapter();
    r.register(a);
    r.bindHandler(async () => null);
    await r.start();
    await r.send({ channelId: 'loopback', conversationId: 'c1' }, { text: 'proactivo' });
    expect(a.status().sentCount).toBe(1);
  });

  it('send() falla si canal no registrado', async () => {
    const r = channelRegistry();
    await expect(r.send({ channelId: 'discord', conversationId: 'x' }, { text: 't' }))
      .rejects.toThrow(/No hay adaptador/);
  });

  it('send() falla si canal sin config', async () => {
    const r = channelRegistry();
    r.register(new DiscordAdapter());
    delete process.env.DISCORD_BOT_TOKEN;
    await expect(r.send({ channelId: 'discord', conversationId: 'x' }, { text: 't' }))
      .rejects.toThrow(/no está configurado/);
  });
});

describe('Real adapter metadata (no network)', () => {
  it('DiscordAdapter: requiredEnvVars y isConfigured', () => {
    delete process.env.DISCORD_BOT_TOKEN;
    const a = new DiscordAdapter();
    expect(a.id).toBe('discord');
    expect(a.requiredEnvVars()).toContain('DISCORD_BOT_TOKEN');
    expect(a.isConfigured()).toBe(false);
    process.env.DISCORD_BOT_TOKEN = 'fake';
    expect(a.isConfigured()).toBe(true);
    delete process.env.DISCORD_BOT_TOKEN;
  });

  it('SlackAdapter: necesita BOTH bot y app tokens', () => {
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_APP_TOKEN;
    const a = new SlackAdapter();
    expect(a.isConfigured()).toBe(false);
    process.env.SLACK_BOT_TOKEN = 'xoxb-fake';
    expect(a.isConfigured()).toBe(false); // falta app token
    process.env.SLACK_APP_TOKEN = 'xapp-fake';
    expect(a.isConfigured()).toBe(true);
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_APP_TOKEN;
  });

  it('EmailAdapter: necesita IMAP + SMTP completos', () => {
    for (const k of ['IMAP_HOST', 'IMAP_USER', 'IMAP_PASS', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) delete process.env[k];
    const a = new EmailAdapter();
    expect(a.isConfigured()).toBe(false);
    process.env.IMAP_HOST = 'imap.example.com';
    process.env.IMAP_USER = 'me@x';
    process.env.IMAP_PASS = 'pw';
    expect(a.isConfigured()).toBe(false);
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'me@x';
    process.env.SMTP_PASS = 'pw';
    expect(a.isConfigured()).toBe(true);
    for (const k of ['IMAP_HOST', 'IMAP_USER', 'IMAP_PASS', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) delete process.env[k];
  });
});
