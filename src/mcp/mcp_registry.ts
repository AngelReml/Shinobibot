// src/mcp/mcp_registry.ts
//
// Registra las herramientas de un servidor MCP como Tools NATIVAS de shinobi.
// Cada tool MCP se envuelve en un Tool del registry con nombre
// `mcp__<server>__<tool>`, de modo que pasa por el MISMO camino que cualquier
// otra: audit JSONL, loop-detector, gate de aprobación, ToolSearch y modo
// deferred. Así cientos de tools externas se integran sin tratamiento especial.

import { registerTool, unregisterTool, getTool, type Tool, type ToolResult } from '../tools/tool_registry.js';
import type { McpClient, McpToolDef, McpCallResult } from './types.js';

interface ConnectedServer {
  client: McpClient;
  toolNames: string[];
}

const _servers = new Map<string, ConnectedServer>();

function sanitize(s: string): string {
  return (s || 'srv').replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'srv';
}

/** Nombre canónico de una tool MCP en el registry de shinobi. */
export function mcpToolName(server: string, tool: string): string {
  return `mcp__${sanitize(server)}__${tool}`;
}

/** Convierte el inputSchema MCP al schema de parámetros de un Tool de shinobi. */
function normalizeSchema(inputSchema: any): Tool['parameters'] {
  if (inputSchema && typeof inputSchema === 'object' && inputSchema.type === 'object') {
    return {
      type: 'object',
      properties: inputSchema.properties && typeof inputSchema.properties === 'object' ? inputSchema.properties : {},
      required: Array.isArray(inputSchema.required) ? inputSchema.required : undefined,
    };
  }
  return { type: 'object', properties: {} };
}

/** Extrae el texto legible de un resultado MCP. */
export function extractText(r: McpCallResult): string {
  if (!r || !Array.isArray(r.content)) return '';
  return r.content
    .map((c) => (typeof c?.text === 'string' ? c.text : c?.type ? `[${c.type}]` : ''))
    .filter(Boolean)
    .join('\n');
}

/**
 * Lista las tools del servidor `server` (vía `client`) y las registra. Devuelve
 * los nombres registrados. Reemplaza un servidor con el mismo nombre si ya
 * estaba conectado (desregistra sus tools antes).
 */
export async function registerMcpServer(server: string, client: McpClient): Promise<{ registered: string[] }> {
  await disconnectMcpServer(server); // idempotente: limpia una conexión previa

  let defs: McpToolDef[];
  try {
    defs = await client.listTools();
  } catch (e: any) {
    try { await client.close(); } catch { /* ignore */ }
    throw new Error(`listTools del servidor MCP "${server}" falló: ${e?.message ?? e}`);
  }

  const registered: string[] = [];
  for (const def of defs) {
    if (!def?.name) continue;
    const name = mcpToolName(server, def.name);
    const tool: Tool = {
      name,
      description: `[MCP:${server}] ${def.description ?? def.name}`,
      parameters: normalizeSchema(def.inputSchema),
      categories: ['mcp'],
      async execute(args: any): Promise<ToolResult> {
        try {
          const r = await client.callTool(def.name, args ?? {});
          const text = extractText(r);
          if (r?.isError) {
            return { success: false, output: '', error: text || `La tool MCP "${def.name}" devolvió error.` };
          }
          return { success: true, output: text };
        } catch (e: any) {
          return { success: false, output: '', error: e?.message ?? String(e) };
        }
      },
    };
    registerTool(tool);
    registered.push(name);
  }

  _servers.set(server, { client, toolNames: registered });
  return { registered };
}

/** Desregistra las tools de un servidor y cierra su cliente. Idempotente. */
export async function disconnectMcpServer(server: string): Promise<void> {
  const entry = _servers.get(server);
  if (!entry) return;
  for (const name of entry.toolNames) {
    if (getTool(name)) unregisterTool(name);
  }
  _servers.delete(server);
  try { await entry.client.close(); } catch { /* best-effort */ }
}

/** Nombres de los servidores MCP conectados. */
export function connectedMcpServers(): string[] {
  return [..._servers.keys()];
}

/** Tools registradas por un servidor MCP conectado. */
export function mcpServerTools(server: string): string[] {
  return _servers.get(server)?.toolNames ?? [];
}

/** Solo para tests: limpia todo el estado MCP. */
export async function _resetMcp(): Promise<void> {
  for (const server of [..._servers.keys()]) await disconnectMcpServer(server);
}
