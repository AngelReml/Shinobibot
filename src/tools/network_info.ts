/**
 * Network Info — interfaces, IPs, MAC. Read-only.
 *
 * Implementación NATIVA (`os.networkInterfaces()`). NO lanza PowerShell
 * ni `Get-NetAdapter`/`Get-NetIPAddress`: enumerar adaptadores de red vía
 * un proceso hijo, encadenado con consultas de SO y procesos, es justo el
 * patrón que el ATC del antivirus marca como recon. `os` lee lo mismo
 * en-proceso. (Se pierden `status`/`linkSpeed`, que no aporta Node nativo.)
 */
import os from 'node:os';
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';

const tool: Tool = {
  name: 'network_info',
  description: 'List Windows network adapters with name, IPv4 address, netmask and MAC. Read-only.',
  parameters: { type: 'object', properties: {}, required: [] },

  async execute(): Promise<ToolResult> {
    const ifaces = os.networkInterfaces();
    const out: Array<Record<string, unknown>> = [];
    for (const [name, addrs] of Object.entries(ifaces)) {
      if (!addrs) continue;
      // `family` es 'IPv4' (string) en Node moderno; algunas versiones usan 4.
      const v4 = addrs.find((a) => a.family === 'IPv4' || (a.family as unknown) === 4);
      if (!v4) continue;
      out.push({
        name,
        ipv4: v4.address,
        netmask: v4.netmask,
        mac: v4.mac,
        internal: v4.internal,       // true = loopback / virtual interna
      });
    }
    return { success: true, output: JSON.stringify(out) };
  },
};

registerTool(tool);
export default tool;
