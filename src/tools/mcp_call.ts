// src/tools/mcp_call.ts
//
// Pasarela única a las herramientas de los servidores MCP conectados. Las tools
// MCP NO se anuncian al modelo (un servidor grande trae cientos de esquemas):
// el agente las encuentra con `tool_search`, que le da su esquema, y las llama
// por aquí. La lista de herramientas anunciadas no cambia nunca, así que la
// caché de prompt se conserva. La llamada real pasa por la tool registrada
// `mcp__<server>__<tool>`; el candado mira el destino (approval.mcpTargetName).

import { type Tool, type ToolResult, registerTool, getTool } from './tool_registry.js';
import { mcpTargetName } from '../security/approval.js';
import { connectedMcpServers, mcpServerTools, mcpServerKey } from '../mcp/mcp_registry.js';

const mcpCallTool: Tool = {
  name: 'mcp_call',
  description:
    'Llama a una herramienta de un servidor MCP conectado. Antes, usa `tool_search` ' +
    '(con `server` + `query`, o con `names`) para ver qué herramientas hay y el ' +
    'esquema de sus argumentos; después llámala aquí con esos argumentos.',
  parameters: {
    type: 'object',
    properties: {
      server: { type: 'string', description: 'Nombre del servidor MCP conectado (p. ej. "rea").' },
      tool: { type: 'string', description: 'Nombre de la herramienta en ese servidor (p. ej. "open_binary").' },
      args: { type: 'object', description: 'Argumentos de la herramienta, según el esquema que devolvió tool_search.' },
    },
    required: ['server', 'tool'],
  },
  categories: ['mcp-gateway'],

  async execute(input: { server?: string; tool?: string; args?: any }): Promise<ToolResult> {
    const servers = connectedMcpServers();
    if (servers.length === 0) {
      return { success: false, output: '', error: 'No hay ningún servidor MCP conectado. El usuario puede añadir uno con /mcp add.' };
    }
    const name = mcpTargetName(input);
    if (!name) return { success: false, output: '', error: 'mcp_call requiere "server" y "tool".' };
    const target = getTool(name);
    if (!target) {
      const server = servers.find((s) => name.startsWith(`mcp__${mcpServerKey(s)}__`));
      if (!server) return { success: false, output: '', error: `No hay ningún servidor MCP conectado llamado "${input.server ?? ''}". Conectados: ${servers.join(', ')}.` };
      const short = name.slice(`mcp__${mcpServerKey(server)}__`.length);
      const near = mcpServerTools(server).map((n) => n.slice(`mcp__${mcpServerKey(server)}__`.length)).filter((n) => n.includes(short) || short.includes(n)).slice(0, 8);
      return { success: false, output: '', error: `El servidor "${server}" no tiene la herramienta "${short}".${near.length ? ` Parecidas: ${near.join(', ')}.` : ''} Búscala con tool_search (server="${server}").` };
    }
    let args = input.args;
    // Algunos modelos mandan los argumentos como texto JSON.
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { /* se pasa tal cual */ } }
    return target.execute(args && typeof args === 'object' ? args : {});
  },
};

registerTool(mcpCallTool);
export default mcpCallTool;
