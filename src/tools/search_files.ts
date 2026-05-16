/**
 * SearchFiles Tool — Search text content across files (like grep)
 */
import { execFile } from 'child_process';
import * as path from 'path';
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';

const DEFAULT_INCLUDE = ['*.ts', '*.js', '*.json', '*.py', '*.md', '*.txt', '*.css', '*.html'];
// Patrón de fichero válido: extensiones / wildcards simples. Bloquea cualquier
// metacarácter de shell (`&`, `|`, `;`, espacios ya separados) — cierra el
// vector de command injection vía `include` (hallazgo de la auditoría).
const SAFE_INCLUDE = /^[\w*.\-]+$/;

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
    const query = String(args.query ?? '');
    if (!query) {
      return { success: false, output: '', error: 'search_files requires a non-empty query.' };
    }

    // Patrones de fichero validados uno a uno. execFile NO pasa por el shell,
    // así que la query y los patrones van como argv directos: sin escape de
    // comillas, sin riesgo de inyección.
    let patterns: string[];
    if (args.include) {
      patterns = args.include.split(/\s+/).filter(Boolean);
      const bad = patterns.find(p => !SAFE_INCLUDE.test(p));
      if (bad) {
        return { success: false, output: '', error: `Invalid include pattern: "${bad}". Use e.g. "*.ts".` };
      }
    } else {
      patterns = DEFAULT_INCLUDE;
    }

    // findstr /C:<literal> — la query va pegada al flag como un único argv.
    const findstrArgs = ['/S', '/N', '/I', `/C:${query}`, ...patterns];

    return new Promise((resolve) => {
      execFile('findstr', findstrArgs, { cwd: searchDir, timeout: 15_000, encoding: 'utf-8', maxBuffer: 512 * 1024, windowsHide: true }, (_error, stdout) => {
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
