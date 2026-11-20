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
  /** Directorio de trabajo del proceso servidor. */
  cwd?: string;
  /** Tope de espera por llamada, en ms (default SHINOBI_MCP_TIMEOUT_MS o 10 min). */
  timeoutMs?: number;
}

/** Tope de espera por llamada MCP. El del SDK (60 s) corta análisis largos. */
export function mcpCallTimeoutMs(explicit?: number): number {
  const n = Number(explicit ?? process.env.SHINOBI_MCP_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 1000 ? Math.min(n, 3_600_000) : 600_000;
}

/**
 * Variables de RED del entorno que se pasan al servidor. El SDK solo hereda un
 * subconjunto mínimo (PATH, HOME…); sin el proxy ni los certificados de la
 * máquina, un `npx` detrás de un proxy se queda colgado bajando el paquete.
 * Solo ajustes de red: nunca claves ni tokens.
 */
export function networkEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  const keep = /^(https?_proxy|no_proxy|all_proxy|node_extra_ca_certs|ssl_cert_file|ssl_cert_dir|npm_config_(https?_?proxy|noproxy|registry|cafile|cache|userconfig|strict_ssl))$/i;
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string' && v && keep.test(k)) out[k] = v;
  }
  return out;
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
    env: { ...networkEnv(), ...(config.env ?? {}) },
    cwd: config.cwd,
    stderr: 'pipe', // no ensucia la terminal; se guarda la cola para explicar un fallo de arranque
  });
  let stderrTail = '';
  transport.stderr?.on('data', (chunk: any) => { stderrTail = (stderrTail + String(chunk)).slice(-1500); });
  const timeout = mcpCallTimeoutMs(config.timeoutMs);
  try {
    await client.connect(transport);
  } catch (e: any) {
    try { await client.close(); } catch { /* ignore */ }
    const tail = stderrTail.trim();
    throw new Error(`${e?.message ?? e}${tail ? ` — salida del servidor: ${tail}` : ''}`);
  }

  return {
    async listTools(): Promise<McpToolDef[]> {
      const r = await client.listTools();
      return (r.tools ?? []).map((t: any) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations }));
    },
    async callTool(name: string, args: any): Promise<McpCallResult> {
      const r = await client.callTool({ name, arguments: args ?? {} }, undefined, { timeout, resetTimeoutOnProgress: true, maxTotalTimeout: timeout });
      return { content: (r.content as any) ?? [], isError: (r as any).isError };
    },
    async close(): Promise<void> {
      await client.close();
    },
  };
}
