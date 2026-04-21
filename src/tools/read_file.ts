/**
 * ReadFile Tool — Read file contents with optional line ranges
 */
import * as fs from 'fs';
import * as path from 'path';
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { validatePath } from '../utils/permissions.js';

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
    const filePath = path.resolve(args.path);
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

    return {
      success: true,
      output: `File: ${filePath} (${lines.length} lines)\n${content}`,
    };
  },
};

registerTool(readFileTool);
export default readFileTool;
