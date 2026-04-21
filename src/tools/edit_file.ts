/**
 * EditFile Tool — Partial file modification via search & replace
 * Inspired by Claude Code's FileEditTool
 */
import * as fs from 'fs';
import * as path from 'path';
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { validatePath } from '../utils/permissions.js';

const editFileTool: Tool = {
  name: 'edit_file',
  description: 'Edit a file by replacing an exact text match with new content. The target text must appear exactly once in the file. Use read_file first to see the current content.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to edit' },
      target: { type: 'string', description: 'The exact text to find and replace (must be unique in the file)' },
      replacement: { type: 'string', description: 'The text to replace the target with' },
    },
    required: ['path', 'target', 'replacement'],
  },

  async execute(args: { path: string; target: string; replacement: string }): Promise<ToolResult> {
    const filePath = path.resolve(args.path);
    const check = validatePath(filePath, 'write');
    if (!check.allowed) return { success: false, output: '', error: check.reason };

    if (!fs.existsSync(filePath)) {
      return { success: false, output: '', error: `File not found: ${filePath}` };
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const occurrences = content.split(args.target).length - 1;

    if (occurrences === 0) {
      return { success: false, output: '', error: `Target text not found in ${filePath}. Use read_file to verify the exact content.` };
    }
    if (occurrences > 1) {
      return { success: false, output: '', error: `Target text found ${occurrences} times in ${filePath}. It must be unique. Use a longer/more specific target.` };
    }

    const newContent = content.replace(args.target, args.replacement);
    fs.writeFileSync(filePath, newContent, 'utf-8');

    return {
      success: true,
      output: `Edited ${filePath}: replaced ${args.target.split('\n').length} lines with ${args.replacement.split('\n').length} lines.`,
    };
  },
};

registerTool(editFileTool);
export default editFileTool;
