// desktop-excel-open-and-extract — Node entry that delegates to extract.ps1.
// Registers itself with the in-process Shinobi tool registry. The PowerShell
// helper does the COM Automation; we only orchestrate args + parse the JSON.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { registerTool } from '../../../../src/tools/tool_registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PS1 = join(__dirname, 'extract.ps1');

const tool = {
  name: 'desktop_excel_open_and_extract',
  description: 'Open an Excel workbook and extract a sheet/range as JSON. Windows only. Requires Excel installed.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to .xlsx/.xlsm/.xls' },
      sheet: { type: 'string' },
      range: { type: 'string', description: 'A1 notation, e.g. A1:D20' },
      headerRow: { type: 'boolean', default: true },
      visible: { type: 'boolean', default: false },
      closeOnExit: { type: 'boolean', default: true },
    },
    required: ['path'],
  },
  async execute(args) {
    if (!args || typeof args.path !== 'string') {
      return { success: false, output: '', error: 'path (string) required' };
    }
    if (process.platform !== 'win32') {
      return { success: false, output: '', error: 'Windows-only skill' };
    }
    if (!existsSync(PS1)) {
      return { success: false, output: '', error: `helper missing: ${PS1}` };
    }
    const cliArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1, '-Path', args.path];
    if (args.sheet) cliArgs.push('-Sheet', args.sheet);
    if (args.range) cliArgs.push('-Range', args.range);
    if (args.headerRow ?? true) cliArgs.push('-HeaderRow');
    if (args.visible) cliArgs.push('-Visible');
    if (args.closeOnExit === false) cliArgs.push('-KeepOpen');
    const r = spawnSync('powershell', cliArgs, { encoding: 'utf-8', timeout: 60_000 });
    if (r.error) return { success: false, output: '', error: `spawn error: ${r.error.message}` };
    const stdout = (r.stdout || '').trim();
    if (!stdout) {
      return { success: false, output: '', error: `no output (exit=${r.status}); stderr=${(r.stderr || '').slice(0, 400)}` };
    }
    try {
      const parsed = JSON.parse(stdout);
      if (parsed.success === false) return { success: false, output: '', error: parsed.error ?? 'extraction failed' };
      return { success: true, output: JSON.stringify(parsed), error: '' };
    } catch (e) {
      return { success: false, output: '', error: `json parse failed: ${e.message}; raw=${stdout.slice(0, 200)}` };
    }
  },
};

registerTool(tool);
export default tool;
