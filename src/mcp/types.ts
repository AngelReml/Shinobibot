// src/mcp/types.ts
//
// Contrato MÍNIMO de un cliente MCP, desacoplado del SDK oficial. Permite
// testear el registro/wrapping con un cliente falso (sin spawnear procesos) y
// cambiar de transporte (stdio/http) sin tocar el registry.

export interface McpToolDef {
  name: string;
  description?: string;
  /** JSON Schema de los argumentos (forma OpenAI-compatible). */
  inputSchema?: any;
}

export interface McpContentPart {
  type: string;
  text?: string;
  [k: string]: any;
}

export interface McpCallResult {
  content: McpContentPart[];
  isError?: boolean;
}

/** Cliente MCP que el registry consume. El adaptador real (stdio) lo implementa. */
export interface McpClient {
  listTools(): Promise<McpToolDef[]>;
  callTool(name: string, args: any): Promise<McpCallResult>;
  close(): Promise<void>;
}
