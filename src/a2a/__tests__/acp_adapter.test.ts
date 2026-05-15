import { describe, it, expect } from 'vitest';
import {
  parseAcpRequest, acpRequestToEnvelope, envelopeResponseToAcp, acpAgentCard,
} from '../acp_adapter.js';

describe('parseAcpRequest', () => {
  it('acepta request válido', () => {
    const r = parseAcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(r).not.toBeNull();
    expect(r?.method).toBe('initialize');
  });
  it('rechaza jsonrpc != 2.0', () => {
    expect(parseAcpRequest({ jsonrpc: '1.0', id: 1, method: 'x' })).toBeNull();
  });
  it('rechaza sin method', () => {
    expect(parseAcpRequest({ jsonrpc: '2.0', id: 1 })).toBeNull();
  });
  it('rechaza method vacío', () => {
    expect(parseAcpRequest({ jsonrpc: '2.0', id: 1, method: '' })).toBeNull();
  });
  it('rechaza id no number/string', () => {
    expect(parseAcpRequest({ jsonrpc: '2.0', id: { obj: true }, method: 'x' })).toBeNull();
  });
  it('rechaza null', () => {
    expect(parseAcpRequest(null)).toBeNull();
  });
});

describe('acpRequestToEnvelope', () => {
  it('initialize → intent ping', () => {
    const env = acpRequestToEnvelope({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { v: 1 } })!;
    expect(env.intent).toBe('ping');
    expect(env.payload).toEqual({ acpMethod: 'initialize', acpParams: { v: 1 } });
  });

  it('session/prompt → capability_invoke', () => {
    const env = acpRequestToEnvelope({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { text: 'hola' } })!;
    expect(env.intent).toBe('capability_invoke');
  });

  it('session/new → mission_handoff', () => {
    const env = acpRequestToEnvelope({ jsonrpc: '2.0', id: 'abc', method: 'session/new' })!;
    expect(env.intent).toBe('mission_handoff');
  });

  it('session/load → memory_query', () => {
    const env = acpRequestToEnvelope({ jsonrpc: '2.0', id: 3, method: 'session/load' })!;
    expect(env.intent).toBe('memory_query');
  });

  it('método desconocido → null', () => {
    expect(acpRequestToEnvelope({ jsonrpc: '2.0', id: 1, method: 'unknown/method' })).toBeNull();
  });

  it('traceId incluye el id ACP', () => {
    const env = acpRequestToEnvelope({ jsonrpc: '2.0', id: 42, method: 'initialize' })!;
    expect(env.traceId).toMatch(/^acp_42_/);
  });

  it('from configurable', () => {
    const env = acpRequestToEnvelope(
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
      { selfId: 'shinobi', from: 'zed-editor' }
    )!;
    expect(env.from).toBe('zed-editor');
    expect(env.to).toBe('shinobi');
  });
});

describe('envelopeResponseToAcp', () => {
  it('ok=true → result en respuesta', () => {
    const r = envelopeResponseToAcp(7, { ok: true, result: { pong: true } });
    expect(r.jsonrpc).toBe('2.0');
    expect(r.id).toBe(7);
    expect(r.result).toEqual({ pong: true });
    expect(r.error).toBeUndefined();
  });

  it('ok=false → error con code mapeado', () => {
    const r = envelopeResponseToAcp(1, { ok: false, error: 'unauthorized' });
    expect(r.error?.code).toBe(-32001);
    expect(r.error?.message).toBe('unauthorized');
  });

  it('envelope_invalid → -32600 (Invalid Request)', () => {
    const r = envelopeResponseToAcp(1, { ok: false, error: 'envelope_invalid' });
    expect(r.error?.code).toBe(-32600);
  });

  it('no_handler_for_intent → -32601 (Method not found)', () => {
    const r = envelopeResponseToAcp(1, { ok: false, error: 'no_handler_for_intent:capability_invoke' });
    expect(r.error?.code).toBe(-32601);
  });

  it('wrong_destination → -32602', () => {
    const r = envelopeResponseToAcp(1, { ok: false, error: 'wrong_destination: to=other' });
    expect(r.error?.code).toBe(-32602);
  });

  it('error desconocido → -32000 (generic server error)', () => {
    const r = envelopeResponseToAcp(1, { ok: false, error: 'something_else' });
    expect(r.error?.code).toBe(-32000);
  });
});

describe('acpAgentCard', () => {
  it('genera estructura ACP/1', () => {
    const card = acpAgentCard({
      agentId: 'shinobi',
      displayName: 'Shinobi',
      version: '0.3.2',
      endpoint: 'http://localhost:3333/acp',
      capabilities: [{ name: 'x', description: 'y' }],
    });
    expect(card.protocol).toBe('acp/1');
    expect(card.agent.agentId).toBe('shinobi');
    expect(card.agent.auth).toBe('bearer');
    expect(card.jsonRpcMethods).toContain('initialize');
    expect(card.jsonRpcMethods).toContain('session/prompt');
  });
});
