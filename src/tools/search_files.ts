/**
 * SearchFiles Tool — Search text content across files (like grep)
 */
import { exec } from 'child_process';
import * as path from 'path';
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';

const searchFilesTool: Tool = {
  name: 'search_files',
  description: 'Search for text patterns across files in a directory. Returns matching lines with filenames and line numbers. Similar to grep/findstr. Use this to find where a function is defined, where a variable is used, etc.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The text or pattern to search for' },
      path: { type: 'string', description: 'Directory to search in (defaults to current directory)' },
      include: { type: 'string', description: 'Optional: file extension filter (e.g. "*.ts" or "*.py")' },
    },
    required: ['query'],
  },

  async execute(args: { query: string; path?: string; include?: string }): Promise<ToolResult> {
    const searchDir = path.resolve(args.path || '.');
    const query = args.query.replace(/"/g, '\\"');

    // Use findstr on Windows (always available)
    let cmd: string;
    if (args.include) {
      cmd = `findstr /S /N /I /C:"${query}" ${args.include}`;
    } else {
      cmd = `findstr /S /N /I /C:"${query}" *.ts *.js *.json *.py *.md *.txt *.css *.html`;
    }

    return new Promise((resolve) => {
      exec(cmd, { cwd: searchDir, timeout: 15_000, encoding: 'utf-8', maxBuffer: 512 * 1024 }, (error, stdout) => {
        const lines = (stdout || '').trim().split('\n').filter(Boolean);

        if (lines.length === 0) {
          resolve({ success: true, output: `No matches found for "${args.query}" in ${searchDir}` });
          return;
        }

        // Limit to first 30 results
        const truncated = lines.length > 30;
        const results = lines.slice(0, 30).join('\n');
        const summary = truncated
          ? `\n\n... and ${lines.length - 30} more matches (showing first 30)`
          : '';

        resolve({
          success: true,
          output: `Found ${lines.length} matches for "${args.query}" in ${searchDir}:\n\n${results}${summary}`,
        });
      });
    });
  },
};

registerTool(searchFilesTool);
export default searchFilesTool;
