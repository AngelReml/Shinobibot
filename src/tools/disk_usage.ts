/**
 * Disk Usage — espacio libre por drive. Útil para advertir antes de
 * escrituras grandes o instalaciones.
 */
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { runPowerShell, tryParseJson } from './_powershell.js';

const tool: Tool = {
  name: 'disk_usage',
  description: 'List Windows logical drives with total size, free space and percentage used. Read-only.',
  parameters: { type: 'object', properties: {}, required: [] },

  async execute(): Promise<ToolResult> {
    const script =
      `Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" ` +
      `| Select-Object @{n='drive';e={$_.DeviceID}}, ` +
      `@{n='label';e={$_.VolumeName}}, ` +
      `@{n='totalGB';e={[math]::Round($_.Size / 1GB, 1)}}, ` +
      `@{n='freeGB';e={[math]::Round($_.FreeSpace / 1GB, 1)}}, ` +
      `@{n='usedPct';e={ if ($_.Size -gt 0) { [math]::Round((($_.Size - $_.FreeSpace) / $_.Size) * 100, 1) } else { 0 } }} ` +
      `| ConvertTo-Json -Compress`;
    const r = await runPowerShell(script);
    if (!r.success) {
      return { success: false, output: '', error: r.stderr || `PowerShell exited ${r.exitCode}` };
    }
    const parsed = tryParseJson(r.stdout);
    if (parsed == null) {
      return { success: true, output: '[]' };
    }
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return { success: true, output: JSON.stringify(arr) };
  },
};

registerTool(tool);
export default tool;
