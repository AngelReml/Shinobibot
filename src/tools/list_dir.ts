/**
 * ListDir Tool — List directory contents with sizes
 */
import * as fs from 'fs';
import * as path from 'path';
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { validatePath } from '../utils/permissions.js';

const listDirTool: Tool = {
  name: 'list_dir',
  description: 'List the contents of a directory. Shows files (with sizes) and subdirectories. Useful for understanding project structure.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the directory to list (defaults to current directory)' },
    },
    required: [],
  },

  async execute(args: { path?: string }): Promise<ToolResult> {
    const dirPath = path.resolve(args.path || '.');
    const check = validatePath(dirPath, 'read');
    if (!check.allowed) return { success: false, output: '', error: check.reason };

    if (!fs.existsSync(dirPath)) {
      return { success: false, output: '', error: `Directory not found: ${dirPath}` };
    }

    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) {
      return { success: false, output: '', error: `Not a directory: ${dirPath}. Use read_file instead.` };
    }

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const lines: string[] = [`Directory: ${dirPath}\n`];
      const dirs: string[] = [];
      const files: string[] = [];

      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

        if (entry.isDirectory()) {
          dirs.push(`  📁 ${entry.name}/`);
        } else {
          try {
            const s = fs.statSync(path.join(dirPath, entry.name));
            const sizeKB = (s.size / 1024).toFixed(1);
            files.push(`  📄 ${entry.name}  (${sizeKB} KB)`);
          } catch {
            files.push(`  📄 ${entry.name}`);
          }
        }
      }

      lines.push(...dirs, ...files);
      lines.push(`\n${dirs.length} directories, ${files.length} files`);

      return { success: true, output: lines.join('\n') };
    } catch (err: any) {
      return { success: false, output: '', error: `Failed to list directory: ${err.message}` };
    }
  },
};

registerTool(listDirTool);
export default listDirTool;
