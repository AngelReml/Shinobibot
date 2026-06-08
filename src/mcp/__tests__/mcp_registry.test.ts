// src/mcp/__tests__/mcp_registry.test.ts
//
// Tests de la integración MCP con un cliente FALSO (sin spawnear procesos ni el
// SDK). Valida el registro/wrapping, ruteo de llamadas, errores y la tool.

import { describe, it, expect, afterEach } from 'vitest';
import {
  registerMcpServer,
  disconnectMcpServer,
  connectedMcpServers,
  mcpToolName,
  extractText,
  _resetMcp,
} from '../mcp_registry.js';
import { getTool } from '../../tools/tool_registry.js';
import mcpConnectTool, { __setMcpClientFactoryForTest } from '../../tools/mcp_connect.js';
import type { McpClient, McpToolDef } from '../types.js';

function fakeClient(tools: McpToolDef[], opts: { call?: (n: string, a: any) => any; state?: { closed: boolean } } = {}): McpClient {
  return {
    async listTools() { return tools; },
    async callTool(name, args) {
      return opts.call ? opts.call(name, args) : { content: [{ type: 'text', text: `called ${name} ${JSON.stringify(args)}` }] };
    },
    async close() { if (opts.state) opts.state.closed = true; },
  };
}

afterEach(async () => {
  await _resetMcp();
  __setMcpClientFactoryForTest(null);
});

describe('mcp_registry', () => {
  it('registra las tools del servidor con nombre mcp__server__tool y son llamables', async () => {
    const client = fakeClient([
      { name: 'echo', description: 'Echoes input', inputSchema: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] } },
      { name: 'ping' },
    ]);
    const { registered } = await registerMcpServer('demo', client);
    expect(registered).toEqual([mcpToolName('demo', 'echo'), mcpToolName('demo', 'ping')]);

    const echo = getTool('mcp__demo__echo')!;
    expect(echo).toBeTruthy();
    expect(echo.description).toMatch(/\[MCP:demo\]/);
    // schema mapeado
    expect(echo.parameters.properties).toHaveProperty('msg');
    expect(echo.parameters.required).toEqual(['msg']);
    // ejecuta → rutea a callTool
    const res = await echo.execute({ msg: 'hola' });
    expect(res.success).toBe(true);
    expect(res.output).toContain('called echo');

    expect(connectedMcpServers()).toEqual(['demo']);
  });

  it('un resultado MCP con isError → tool falla', async () => {
    const client = fakeClient([{ name: 't' }], { call: () => ({ content: [{ type: 'text', text: 'boom' }], isError: true }) });
    await registerMcpServer('s', client);
    const res = await getTool('mcp__s__t')!.execute({});
    expect(res.success).toBe(false);
    expect(res.error).toContain('boom');
  });

  it('listTools que lanza → registerMcpServer lanza y cierra el cliente', async () => {
    const state = { closed: false };
    const bad: McpClient = {
      async listTools() { throw new Error('handshake failed'); },
      async callTool() { return { content: [] }; },
      async close() { state.closed = true; },
    };
    await expect(registerMcpServer('bad', bad)).rejects.toThrow(/handshake failed/);
    expect(state.closed).toBe(true);
  });

  it('disconnect desregistra las tools y cierra el cliente', async () => {
    const state = { closed: false };
    const client = fakeClient([{ name: 'a' }], { state });
    await registerMcpServer('srv', client);
    expect(getTool('mcp__srv__a')).toBeTruthy();
    await disconnectMcpServer('srv');
    expect(getTool('mcp__srv__a')).toBeUndefined();
    expect(connectedMcpServers()).toEqual([]);
    expect(state.closed).toBe(true);
  });

  it('reconectar el mismo nombre reemplaza (idempotente)', async () => {
    await registerMcpServer('x', fakeClient([{ name: 'old' }]));
    await registerMcpServer('x', fakeClient([{ name: 'new' }]));
    expect(getTool('mcp__x__old')).toBeUndefined();
    expect(getTool('mcp__x__new')).toBeTruthy();
  });
});

describe('extractText', () => {
  it('une las partes de texto y marca tipos no-texto', () => {
    expect(extractText({ content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] }))
      .toBe('a\n[image]\nb');
    expect(extractText({ content: [] })).toBe('');
  });
});

describe('mcp_connect (tool)', () => {
  it('conecta vía la factory inyectada y lista las tools', async () => {
    __setMcpClientFactoryForTest(async () => fakeClient([{ name: 'foo' }, { name: 'bar' }]));
    const res = await mcpConnectTool.execute({ name: 'svc', command: 'whatever' });
    expect(res.success).toBe(true);
    expect(res.output).toMatch(/2 herramientas/);
    expect(getTool('mcp__svc__foo')).toBeTruthy();
  });

  it('connect sin command → error', async () => {
    const res = await mcpConnectTool.execute({ name: 'svc' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/command/);
  });

  it('action=disconnect desconecta', async () => {
    __setMcpClientFactoryForTest(async () => fakeClient([{ name: 'foo' }]));
    await mcpConnectTool.execute({ name: 'svc2', command: 'x' });
    expect(getTool('mcp__svc2__foo')).toBeTruthy();
    const res = await mcpConnectTool.execute({ name: 'svc2', action: 'disconnect' });
    expect(res.success).toBe(true);
    expect(getTool('mcp__svc2__foo')).toBeUndefined();
  });
});
