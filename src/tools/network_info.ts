/**
 * Network Info — interfaces, IPs, default gateway. Read-only.
 */
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { runPowerShell, tryParseJson } from './_powershell.js';

const tool: Tool = {
  name: 'network_info',
  description: 'List Windows network adapters with name, status, IPv4 address and MAC. Read-only.',
  parameters: { type: 'object', properties: {}, required: [] },

  async execute(): Promise<ToolResult> {
    // `LinkSpeed` puede venir como string ("1 Gbps") o número según driver;
    // lo devolvemos como string para evitar errores de cast.
    const script =
      `Get-NetAdapter | Where-Object { $_.Status -ne 'Disabled' } ` +
      `| ForEach-Object { ` +
      `  $ipv4 = (Get-NetIPAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty IPAddress); ` +
      `  [PSCustomObject]@{ ` +
      `    name = $_.Name; ` +
      `    status = [string]$_.Status; ` +
      `    mac = $_.MacAddress; ` +
      `    ipv4 = $ipv4; ` +
      `    linkSpeed = [string]$_.LinkSpeed ` +
      `  } ` +
      `} | ConvertTo-Json -Compress`;
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
