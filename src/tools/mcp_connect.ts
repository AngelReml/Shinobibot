// src/tools/mcp_connect.ts
//
// Tool: conecta (o desconecta) un servidor MCP por stdio y registra sus
// herramientas como Tools nativas de shinobi (pasan por audit/aprobación/
// ToolSearch/deferred). Conectar un servidor spawnea un proceso externo → es
// una decisión de confianza; por eso está en DESTRUCTIVE_TOOLS (gate de
// aprobación) y no se da a subagentes.

import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { registerMcpServer, disconnectMcpServer, connectedMcpServers } from '../mcp/mcp_registry.js';
import { createStdioMcpClient, type StdioMcpConfig } from '../mcp/stdio_client.js';
import type { McpClient } from '../mcp/types.js';

type ClientFactory = (cfg: StdioMcpConfig) => Promise<McpClient>;
let _factory: ClientFactory = createStdioMcpClient;
/** Solo para tests: sustituye la fábrica de clientes MCP (sin spawnear). */
export function __setMcpClientFactoryForTest(fn: ClientFactory | null): void {
  _factory = fn ?? createStdioMcpClient;
}

const mcpConnectTool: Tool = {
  name: 'mcp_connect',
  description:
    'Conecta un servidor MCP (Model Context Protocol) por stdio y registra sus ' +
    'herramientas para usarlas como cualquier otra. action="disconnect" lo ' +
    'desconecta. Conectar un servidor ejecuta un proceso externo: úsalo solo con ' +
    'servidores en los que confías.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nombre lógico del servidor (prefijo de sus tools).' },
      command: { type: 'string', description: 'Binario del servidor MCP (para action=connect).' },
      args: { type: 'array', items: { type: 'string' }, description: 'Argumentos del binario.' },
      action: { type: 'string', enum: ['connect', 'disconnect'], description: 'connect (default) o disconnect.' },
    },
    required: ['name'],
  },
  categories: ['coder'],

  async execute(args: { name?: string; command?: string; args?: string[]; action?: string }): Promise<ToolResult> {
    const name = (args.name ?? '').trim();
    if (!name) return { success: false, output: '', error: 'mcp_connect requiere "name".' };

    if (args.action === 'disconnect') {
      await disconnectMcpServer(name);
      return { success: true, output: `Servidor MCP "${name}" desconectado. Conectados: ${connectedMcpServers().join(', ') || '(ninguno)'}.` };
    }

    const command = (args.command ?? '').trim();
    if (!command) return { success: false, output: '', error: 'mcp_connect (connect) requiere "command".' };

    let client: McpClient;
    try {
      client = await _factory({ name, command, args: Array.isArray(args.args) ? args.args : undefined });
    } catch (e: any) {
      return { success: false, output: '', error: `No se pudo conectar al servidor MCP "${name}": ${e?.message ?? e}` };
    }

    try {
      const { registered } = await registerMcpServer(name, client);
      return {
        success: true,
        output: `Servidor MCP "${name}" conectado. ${registered.length} herramientas registradas:\n` +
          (registered.map((t) => `- ${t}`).join('\n') || '(ninguna)'),
      };
    } catch (e: any) {
      return { success: false, output: '', error: e?.message ?? String(e) };
    }
  },
};

registerTool(mcpConnectTool);
export default mcpConnectTool;
