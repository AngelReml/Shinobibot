import { describe, it, expect } from 'vitest';
import {
  A2ADispatcher, isValidEnvelope, generateTraceId, signBody, verifyHmac, buildAgentCard,
  type A2AEnvelope,
} from '../protocol.js';

function makeEnv(over: Partial<A2AEnvelope> = {}): A2AEnvelope {
  return {
    v: 1,
    traceId: 'tr_x',
    from: 'other',
    to: 'shinobi',
    intent: 'ping',
    payload: {},
    ts: new Date().toISOString(),
    ...over,
  };
}

describe('isValidEnvelope', () => {
  it('valida envelopes correctos', () => {
    expect(isValidEnvelope(makeEnv())).toBe(true);
  });
  it('rechaza v != 1', () => {
    expect(isValidEnvelope({ ...makeEnv(), v: 2 as any })).toBe(false);
  });
  it('rechaza intent desconocido', () => {
    expect(isValidEnvelope({ ...makeEnv(), intent: 'evil' as any })).toBe(false);
  });
  it('rechaza from/to vacíos', () => {
    expect(isValidEnvelope(makeEnv({ from: '' }))).toBe(false);
    expect(isValidEnvelope(makeEnv({ to: '' }))).toBe(false);
  });
  it('rechaza null/undefined', () => {
    expect(isValidEnvelope(null)).toBe(false);
    expect(isValidEnvelope(undefined)).toBe(false);
  });
});

describe('generateTraceId', () => {
  it('genera ids distintos con prefijo tr_', () => {
    const a = generateTraceId();
    const b = generateTraceId();
    expect(a).not.toBe(b);
    expect(a.startsWith('tr_')).toBe(true);
  });
});

describe('signBody/verifyHmac', () => {
  it('verifica hmac válido', () => {
    const body = '{"x":1}';
    const sig = signBody(body, 'secret');
    expect(verifyHmac(body, sig, 'secret')).toBe(true);
  });
  it('rechaza secret distinto', () => {
    const body = '{"x":1}';
    const sig = signBody(body, 'secret');
    expect(verifyHmac(body, sig, 'other')).toBe(false);
  });
  it('rechaza body modificado', () => {
    const sig = signBody('{"x":1}', 's');
    expect(verifyHmac('{"x":2}', sig, 's')).toBe(false);
  });
  it('rechaza signature vacía', () => {
    expect(verifyHmac('body', '', 'secret')).toBe(false);
  });
});

describe('A2ADispatcher — dispatch básico', () => {
  it('responde ping con handler registrado', async () => {
    const d = new A2ADispatcher({ selfId: 'shinobi' });
    d.on('ping', async () => ({ result: { pong: true } }));
    const resp = await d.dispatch(makeEnv());
    expect(resp.ok).toBe(true);
    expect((resp.result as any).pong).toBe(true);
  });

  it('error si intent no tiene handler', async () => {
    const d = new A2ADispatcher({ selfId: 'shinobi' });
    const resp = await d.dispatch(makeEnv({ intent: 'capability_invoke' }));
    expect(resp.ok).toBe(false);
    expect(resp.error).toMatch(/no_handler/);
  });

  it('error si envelope inválido', async () => {
    const d = new A2ADispatcher({ selfId: 'shinobi' });
    const resp = await d.dispatch({ garbage: true });
    expect(resp.ok).toBe(false);
    expect(resp.error).toBe('envelope_invalid');
  });

  it('error si to !== selfId', async () => {
    const d = new A2ADispatcher({ selfId: 'shinobi' });
    d.on('ping', async () => ({ result: {} }));
    const resp = await d.dispatch(makeEnv({ to: 'other-agent' }));
    expect(resp.ok).toBe(false);
    expect(resp.error).toMatch(/wrong_destination/);
  });

  it('handler que throw → error reportado', async () => {
    const d = new A2ADispatcher({ selfId: 'shinobi' });
    d.on('ping', async () => { throw new Error('boom'); });
    const resp = await d.dispatch(makeEnv());
    expect(resp.ok).toBe(false);
    expect(resp.error).toMatch(/handler_threw.*boom/);
  });

  it('traceId vacío con allowMissingTrace=true se regenera', async () => {
    const d = new A2ADispatcher({ selfId: 'shinobi', allowMissingTrace: true });
    d.on('ping', async () => ({ result: 'ok' }));
    const resp = await d.dispatch(makeEnv({ traceId: '' }));
    expect(resp.ok).toBe(true);
    expect(resp.traceId).toMatch(/^tr_/);
  });

  it('traceId vacío sin allowMissingTrace → error', async () => {
    const d = new A2ADispatcher({ selfId: 'shinobi' });
    const resp = await d.dispatch(makeEnv({ traceId: '' }));
    expect(resp.ok).toBe(false);
    expect(resp.error).toBe('traceId_missing');
  });
});

describe('A2ADispatcher — auth modes', () => {
  it('bearer correcto pasa', async () => {
    const d = new A2ADispatcher({ selfId: 'shinobi', auth: 'bearer', sharedSecret: 'tok' });
    d.on('ping', async () => ({ result: 'ok' }));
    const resp = await d.dispatch(makeEnv(), { bearer: 'tok' });
    expect(resp.ok).toBe(true);
  });

  it('bearer mismatch → unauthorized', async () => {
    const d = new A2ADispatcher({ selfId: 'shinobi', auth: 'bearer', sharedSecret: 'tok' });
    d.on('ping', async () => ({ result: 'ok' }));
    const resp = await d.dispatch(makeEnv(), { bearer: 'wrong' });
    expect(resp.ok).toBe(false);
    expect(resp.error).toBe('unauthorized');
  });

  it('hmac válido pasa', async () => {
    const secret = 's3cr3t';
    const env = makeEnv();
    const body = JSON.stringify(env);
    const sig = signBody(body, secret);
    const d = new A2ADispatcher({ selfId: 'shinobi', auth: 'hmac', sharedSecret: secret });
    d.on('ping', async () => ({ result: 'ok' }));
    const resp = await d.dispatch(env, { rawBody: body, signature: sig });
    expect(resp.ok).toBe(true);
  });

  it('hmac inválido → rechazado', async () => {
    const d = new A2ADispatcher({ selfId: 'shinobi', auth: 'hmac', sharedSecret: 'x' });
    d.on('ping', async () => ({ result: 'ok' }));
    const resp = await d.dispatch(makeEnv(), { rawBody: '{}', signature: 'fake' });
    expect(resp.ok).toBe(false);
    expect(resp.error).toBe('hmac_invalid');
  });

  it('constructor falla si auth=bearer sin secret', () => {
    expect(() => new A2ADispatcher({ selfId: 'x', auth: 'bearer' })).toThrow(/sharedSecret/);
  });
});

describe('A2ADispatcher — onEvent hook', () => {
  it('llama onEvent en éxito y fallo', async () => {
    const events: Array<{ ok: boolean; error?: string }> = [];
    const d = new A2ADispatcher({
      selfId: 'shinobi',
      onEvent: (info) => events.push({ ok: info.ok, error: info.error }),
    });
    d.on('ping', async () => ({ result: 'ok' }));
    d.on('health', async () => { throw new Error('down'); });
    await d.dispatch(makeEnv());
    await d.dispatch(makeEnv({ intent: 'health' }));
    expect(events.length).toBe(2);
    expect(events[0].ok).toBe(true);
    expect(events[1].ok).toBe(false);
    expect(events[1].error).toMatch(/down/);
  });
});

describe('buildAgentCard', () => {
  it('genera card con defaults', () => {
    const card = buildAgentCard({
      agentId: 'shinobi-1',
      displayName: 'Shinobi',
      version: '0.1.0',
      capabilities: [{ name: 'browse', description: 'Web browsing' }],
    });
    expect(card.agentId).toBe('shinobi-1');
    expect(card.auth).toBe('none');
    expect(card.intents).toContain('ping');
    expect(card.intents).toContain('capability_invoke');
    expect(card.capabilities[0].name).toBe('browse');
  });

  it('respeta auth y endpoint custom', () => {
    const card = buildAgentCard({
      agentId: 'x', displayName: 'X', version: '1', capabilities: [],
      auth: 'bearer', endpoint: 'https://shinobi.example.com/a2a',
    });
    expect(card.auth).toBe('bearer');
    expect(card.endpoint).toBe('https://shinobi.example.com/a2a');
  });
});
