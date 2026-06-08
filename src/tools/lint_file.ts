// src/tools/lint_file.ts
//
// Tool: diagnósticos (LSP-flavored) de un fichero de código. El agente la usa
// para comprobar que lo que escribió compila/parsea antes de seguir.

import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { validatePath } from '../utils/permissions.js';
import { resolveInContext } from '../agents/exec_context.js';
import { runDiagnostics, formatDiagnostics, lspSemanticEnabled } from '../lsp/diagnostics.js';

const lintFileTool: Tool = {
  name: 'lint_file',
  description:
    'Comprueba un fichero de código y devuelve sus problemas (sintaxis/tipos). ' +
    'Soporta TS/JS, JSON y Python. Úsalo tras escribir/editar código para ' +
    'detectar errores antes de continuar. Read-only.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Ruta del fichero a comprobar.' },
      semantic: { type: 'boolean', description: 'Si true, añade chequeo de tipos (no solo sintaxis) para TS/JS.' },
    },
    required: ['path'],
  },
  categories: ['coder'],

  async execute(args: { path?: string; semantic?: boolean }): Promise<ToolResult> {
    const p = (args.path ?? '').trim();
    if (!p) return { success: false, output: '', error: 'lint_file requiere "path".' };
    const filePath = resolveInContext(p);
    const check = validatePath(filePath, 'read');
    if (!check.allowed) return { success: false, output: '', error: check.reason };

    const semantic = args.semantic ?? lspSemanticEnabled();
    const diags = await runDiagnostics(filePath, undefined, { semantic });
    if (diags.length === 0) return { success: true, output: `Sin problemas en ${filePath}.` };
    return { success: true, output: `${filePath}\n${formatDiagnostics(diags)}` };
  },
};

registerTool(lintFileTool);
export default lintFileTool;
