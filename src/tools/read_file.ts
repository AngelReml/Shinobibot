/**
 * ReadFile Tool — Read file contents with optional line ranges
 */
import * as fs from 'fs';
import * as path from 'path';
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { validatePath } from '../utils/permissions.js';
import { resolveInContext } from '../agents/exec_context.js';
import { TOOL_OUTPUT_MAX_CHARS } from '../context/tool_output_truncator.js';

const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read the contents of a file. Optionally specify a line range with startLine and endLine (1-indexed). Use this to inspect code, config files, or any text file.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative path to the file to read' },
      startLine: { type: 'number', description: 'Optional: first line to read (1-indexed)' },
      endLine: { type: 'number', description: 'Optional: last line to read (1-indexed, inclusive)' },
    },
    required: ['path'],
  },

  async execute(args: { path: string; startLine?: number; endLine?: number }): Promise<ToolResult> {
    const filePath = resolveInContext(args.path);
    const check = validatePath(filePath, 'read');
    if (!check.allowed) return { success: false, output: '', error: check.reason };

    if (!fs.existsSync(filePath)) {
      return { success: false, output: '', error: `File not found: ${filePath}` };
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      return { success: false, output: '', error: `Path is a directory, not a file: ${filePath}. Use list_dir instead.` };
    }

    // Cap file size at 500KB
    if (stat.size > 512_000) {
      return { success: false, output: '', error: `File too large (${(stat.size / 1024).toFixed(0)}KB). Use startLine/endLine to read a portion.` };
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    if (args.startLine || args.endLine) {
      const start = Math.max(1, args.startLine || 1);
      const end = Math.min(lines.length, args.endLine || lines.length);
      const slice = lines.slice(start - 1, end);
      return {
        success: true,
        output: `File: ${filePath} (lines ${start}-${end} of ${lines.length})\n${slice.map((l, i) => `${start + i}: ${l}`).join('\n')}`,
      };
    }

    // Full-file read: numeramos cada línea (estilo `N: `) igual que los modos
    // rango y truncado. Sin esto, una lectura completa devolvía contenido crudo
    // y el agente no podía citar números de línea reales (medido en la batería
    // 2026-06-10: pegaba el código correcto pero inventaba la línea). El número
    // es barato y se gana precisión de citado.
    const numbered = lines.map((l, i) => `${i + 1}: ${l}`).join('\n');
    const fullOutput = `File: ${filePath} (${lines.length} lines)\n${numbered}`;
    if (fullOutput.length > TOOL_OUTPUT_MAX_CHARS) {
      // Reserve ~60 % of budget for the head, ~15 % for the tail.
      const headBudget = Math.floor(TOOL_OUTPUT_MAX_CHARS * 0.6);
      const tailBudget = Math.floor(TOOL_OUTPUT_MAX_CHARS * 0.15);

      // Find how many lines fit in each budget.
      let headChars = 0;
      let headLines = 0;
      for (const line of lines) {
        const len = line.length + 1; // +1 for \n
        if (headChars + len > headBudget) break;
        headChars += len;
        headLines++;
      }

      let tailChars = 0;
      let tailLines = 0;
      for (let i = lines.length - 1; i >= headLines; i--) {
        const len = lines[i].length + 1;
        if (tailChars + len > tailBudget) break;
        tailChars += len;
        tailLines++;
      }

      const headContent = lines.slice(0, headLines)
        .map((l, i) => `${i + 1}: ${l}`).join('\n');
      const tailStart = lines.length - tailLines;
      const tailContent = lines.slice(tailStart)
        .map((l, i) => `${tailStart + i + 1}: ${l}`).join('\n');
      const skippedFrom = headLines + 1;
      const skippedTo = tailStart;
      const marker =
        `\n[... contenido truncado: líneas ${skippedFrom}–${skippedTo} omitidas. ` +
        `Usa read_file con startLine/endLine para leer secciones específicas, ` +
        `por ejemplo startLine=${skippedFrom} endLine=${Math.min(skippedFrom + 199, skippedTo)} ...]\n`;

      return {
        success: true,
        output:
          `File: ${filePath} (${lines.length} lines, mostrando 1–${headLines} y ${tailStart + 1}–${lines.length})\n` +
          headContent + marker + tailContent,
      };
    }

    return {
      success: true,
      output: fullOutput,
    };
  },
};

registerTool(readFileTool);
export default readFileTool;
