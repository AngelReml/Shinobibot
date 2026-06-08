/**
 * WriteFile Tool — Create or overwrite a file
 */
import * as fs from 'fs';
import * as path from 'path';
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { validatePath } from '../utils/permissions.js';
import { resolveInContext, contextWorkspaceRoot } from '../agents/exec_context.js';
import { runDiagnostics, formatDiagnostics, lspOnWriteEnabled, lspSemanticEnabled } from '../lsp/diagnostics.js';

const writeFileTool: Tool = {
  name: 'write_file',
  description: 'Create a new file or overwrite an existing file with the given content. Parent directories will be created if they do not exist.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative path to the file to create/overwrite' },
      content: { type: 'string', description: 'The full content to write to the file' },
    },
    required: ['path', 'content'],
  },

  requiresConfirmation(args: { path: string }) {
    const filePath = resolveInContext(args.path);
    const root = path.resolve(contextWorkspaceRoot());
    const scratchPath = path.resolve(root, 'scratch');
    if (filePath.startsWith(scratchPath)) return false;
    // Overwriting existing files requires confirmation
    return fs.existsSync(filePath);
  },

  async execute(args: { path: string; content: string }): Promise<ToolResult> {
    const filePath = resolveInContext(args.path);
    const check = validatePath(filePath, 'write');
    if (!check.allowed) return { success: false, output: '', error: check.reason };

    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const existed = fs.existsSync(filePath);
      fs.writeFileSync(filePath, args.content, 'utf-8');

      let output = `${existed ? 'Overwritten' : 'Created'}: ${filePath} (${args.content.split('\n').length} lines, ${Buffer.byteLength(args.content)} bytes)`;

      // LSP-flavored (opt-in SHINOBI_LSP=1): diagnostica el código recién escrito
      // y adjunta los problemas para que el agente los corrija de inmediato.
      if (lspOnWriteEnabled()) {
        try {
          const diags = await runDiagnostics(filePath, args.content, { semantic: lspSemanticEnabled() });
          if (diags.length > 0) output += `\n${formatDiagnostics(diags)}`;
        } catch { /* best-effort: nunca rompe la escritura */ }
      }

      return { success: true, output };
    } catch (err: any) {
      return { success: false, output: '', error: `Write failed: ${err.message}` };
    }
  },
};

registerTool(writeFileTool);
export default writeFileTool;
