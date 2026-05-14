/**
 * Process List — lista procesos activos. Read-only, distinto de kill
 * (la blacklist destructiva de run_command bloquea kill explícito).
 */
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { runPowerShell, psLit, tryParseJson } from './_powershell.js';

const tool: Tool = {
  name: 'process_list',
  description: 'List currently running processes on Windows with name, PID, memory (MB) and CPU seconds. Read-only — does not kill anything. Optionally filter by name substring.',
  parameters: {
    type: 'object',
    properties: {
      nameFilter: { type: 'string', description: 'Optional case-insensitive substring to filter process names (e.g. "chrome").' },
      limit: { type: 'number', description: 'Optional max number of rows (default 50).' },
    },
    required: [],
  },

  async execute(args: { nameFilter?: string; limit?: number }): Promise<ToolResult> {
    const limit = Math.max(1, Math.min(args.limit ?? 50, 500));
    const filterClause = args.nameFilter
      ? `| Where-Object { $_.ProcessName -like '*' + ${psLit(args.nameFilter)} + '*' }`
      : '';
    const script =
      `Get-Process ${filterClause} ` +
      `| Select-Object @{n='name';e={$_.ProcessName}}, @{n='pid';e={$_.Id}}, ` +
      `@{n='memMB';e={[math]::Round($_.WS / 1MB, 1)}}, @{n='cpuSec';e={[math]::Round($_.CPU, 2)}} ` +
      `| Sort-Object memMB -Descending | Select-Object -First ${limit} ` +
      `| ConvertTo-Json -Compress`;

    const r = await runPowerShell(script);
    if (!r.success) {
      return { success: false, output: '', error: r.stderr || `PowerShell exited ${r.exitCode}` };
    }
    const parsed = tryParseJson(r.stdout);
    if (parsed == null) {
      // 0 procesos matchean → stdout vacío; o single result devuelve objeto.
      return { success: true, output: '[]' };
    }
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return { success: true, output: JSON.stringify(arr) };
  },
};

registerTool(tool);
export default tool;
