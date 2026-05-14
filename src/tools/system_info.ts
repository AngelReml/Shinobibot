/**
 * System Info — OS, CPU, RAM. Útil para que el agente sepa en qué
 * máquina está corriendo antes de proponer comandos.
 */
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { runPowerShell, tryParseJson } from './_powershell.js';

const tool: Tool = {
  name: 'system_info',
  description: 'Get basic Windows system info: OS version, hostname, CPU model, total RAM (GB), uptime. Read-only.',
  parameters: { type: 'object', properties: {}, required: [] },

  async execute(): Promise<ToolResult> {
    const script =
      `$os = Get-CimInstance Win32_OperatingSystem; ` +
      `$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1; ` +
      `$totalMem = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1); ` +
      `$uptime = (Get-Date) - $os.LastBootUpTime; ` +
      `[PSCustomObject]@{ ` +
      `  hostname = $env:COMPUTERNAME; ` +
      `  osCaption = $os.Caption; ` +
      `  osVersion = $os.Version; ` +
      `  osBuild = $os.BuildNumber; ` +
      `  cpu = $cpu.Name; ` +
      `  cores = $cpu.NumberOfCores; ` +
      `  logicalProcessors = $cpu.NumberOfLogicalProcessors; ` +
      `  totalRamGB = $totalMem; ` +
      `  uptimeHours = [math]::Round($uptime.TotalHours, 1) ` +
      `} | ConvertTo-Json -Compress`;
    const r = await runPowerShell(script);
    if (!r.success) {
      return { success: false, output: '', error: r.stderr || `PowerShell exited ${r.exitCode}` };
    }
    const parsed = tryParseJson(r.stdout);
    if (!parsed) {
      return { success: false, output: r.stdout, error: 'No se pudo parsear la respuesta de system_info.' };
    }
    return { success: true, output: JSON.stringify(parsed) };
  },
};

registerTool(tool);
export default tool;
