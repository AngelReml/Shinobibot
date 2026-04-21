/**
 * WriteFile Tool — Create or overwrite a file
 */
import * as fs from 'fs';
import * as path from 'path';
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { validatePath } from '../utils/permissions.js';

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
    // Overwriting existing files requires confirmation
    return fs.existsSync(path.resolve(args.path));
  },

  async execute(args: { path: string; content: string }): Promise<ToolResult> {
    const filePath = path.resolve(args.path);
    const check = validatePath(filePath, 'write');
    if (!check.allowed) return { success: false, output: '', error: check.reason };

    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const existed = fs.existsSync(filePath);
      fs.writeFileSync(filePath, args.content, 'utf-8');

      return {
        success: true,
        output: `${existed ? 'Overwritten' : 'Created'}: ${filePath} (${args.content.split('\n').length} lines, ${Buffer.byteLength(args.content)} bytes)`,
      };
    } catch (err: any) {
      return { success: false, output: '', error: `Write failed: ${err.message}` };
    }
  },
};

registerTool(writeFileTool);
export default writeFileTool;
