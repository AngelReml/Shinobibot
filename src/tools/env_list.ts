/**
 * Env List — lista variables de entorno con redacción automática de
 * valores sensibles (API keys, tokens, passwords). Read-only.
 *
 * Política: por defecto se devuelven todos los nombres y un preview
 * truncado del valor; si el nombre matchea patrones sensibles, el valor
 * se reemplaza por <REDACTED>. El LLM puede pedir un nombre específico
 * pero igual se respeta la redacción.
 */
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';

const SENSITIVE_NAME_PATTERNS = [
  /key/i,
  /token/i,
  /secret/i,
  /password/i,
  /pwd/i,
  /credential/i,
  /auth/i,
  /api_/i,
];

function shouldRedact(name: string): boolean {
  return SENSITIVE_NAME_PATTERNS.some(p => p.test(name));
}

const tool: Tool = {
  name: 'env_list',
  description: 'List Windows environment variables. Values matching sensitive name patterns (key, token, secret, password, credential, auth, api_*) are automatically redacted. Optionally filter by name substring.',
  parameters: {
    type: 'object',
    properties: {
      nameFilter: { type: 'string', description: 'Optional case-insensitive substring to filter variable names.' },
    },
    required: [],
  },

  async execute(args: { nameFilter?: string }): Promise<ToolResult> {
    const filter = args.nameFilter?.toLowerCase();
    const out: Array<{ name: string; value: string }> = [];
    for (const [name, raw] of Object.entries(process.env)) {
      if (filter && !name.toLowerCase().includes(filter)) continue;
      const value = raw ?? '';
      const display = shouldRedact(name)
        ? '<REDACTED>'
        : value.length > 200
          ? `${value.slice(0, 200)}…[truncado ${value.length - 200} chars]`
          : value;
      out.push({ name, value: display });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return { success: true, output: JSON.stringify(out) };
  },
};

registerTool(tool);
export default tool;
