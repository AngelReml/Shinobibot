/**
 * Tool Registry — Central hub for all Shinobi tools
 * Inspired by Claude Code's tool system (src/tools.ts)
 */

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  execute(args: any): Promise<ToolResult>;
  /** Return true if this tool call needs user confirmation before running */
  requiresConfirmation?(args: any): boolean;
}

/** Convert a Shinobi Tool to OpenAI function-calling format */
export function toOpenAITools(tools: Tool[]) {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/** Registry singleton */
const _tools: Map<string, Tool> = new Map();

export function registerTool(tool: Tool) {
  if (_tools.has(tool.name)) {
    console.warn(`[tool-registry] tool '${tool.name}' ya estaba registrada — se sobreescribe`);
  }
  _tools.set(tool.name, tool);
}

export function getTool(name: string): Tool | undefined {
  return _tools.get(name);
}

export function getAllTools(): Tool[] {
  return Array.from(_tools.values());
}

export function getToolNames(): string[] {
  return Array.from(_tools.keys());
}
