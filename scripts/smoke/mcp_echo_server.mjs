// scripts/smoke/mcp_echo_server.mjs
// Servidor MCP mínimo (SDK oficial) para el smoke real del adaptador stdio.
// Expone dos tools: echo(message) y add(a,b). Habla JSON-RPC por stdin/stdout.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'echo-server', version: '1.0.0' });

server.registerTool(
  'echo',
  { description: 'Devuelve el mensaje recibido', inputSchema: { message: z.string() } },
  async ({ message }) => ({ content: [{ type: 'text', text: `echo: ${message}` }] }),
);

server.registerTool(
  'add',
  { description: 'Suma dos números', inputSchema: { a: z.number(), b: z.number() } },
  async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
