// src/mcp/stdio_client.ts
//
// Adaptador REAL: un McpClient sobre el SDK oficial (@modelcontextprotocol/sdk)
// por transporte stdio (spawnea el servidor y habla JSON-RPC por stdin/stdout).
// Import dinámico para que el SDK sea una dependencia perezosa.

import type { McpClient, McpToolDef, McpCallResult } from './types.js';

export interface StdioMcpConfig {
  /** Nombre del cliente que se anuncia al servidor. */
  name?: string;
  version?: string;
  /** Binario del servidor MCP. */
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** Crea y conecta un cliente MCP stdio. Lanza si el SDK o el servidor fallan. */
export async function createStdioMcpClient(config: StdioMcpConfig): Promise<McpClient> {
  if (!config?.command) throw new Error('createStdioMcpClient: "command" es obligatorio.');

  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

  const client = new Client(
    { name: config.name ?? 'shinobi', version: config.version ?? '1.0.0' },
    { capabilities: {} },
  );
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.env,
  });
  await client.connect(transport);

  return {
    async listTools(): Promise<McpToolDef[]> {
      const r = await client.listTools();
      return (r.tools ?? []).map((t: any) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
    },
    async callTool(name: string, args: any): Promise<McpCallResult> {
      const r = await client.callTool({ name, arguments: args ?? {} });
      return { content: (r.content as any) ?? [], isError: (r as any).isError };
    },
    async close(): Promise<void> {
      await client.close();
    },
  };
}
