/**
 * System Info — OS, CPU, RAM. Útil para que el agente sepa en qué
 * máquina está corriendo antes de proponer comandos.
 *
 * Implementación NATIVA (módulo `os` de Node). NO lanza PowerShell ni
 * consulta WMI: un proceso que invoca powershell.exe para leer
 * `Win32_OperatingSystem`/`Win32_Processor` dispara el ATC (Advanced
 * Threat Control) de los antivirus como patrón de recon/info-stealer.
 * `os.*` lee la misma información en-proceso, sin hijos ni firma sospechosa.
 */
import os from 'node:os';
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';

const GB = 1024 ** 3;
const round1 = (n: number): number => Math.round(n * 10) / 10;

const tool: Tool = {
  name: 'system_info',
  description: 'Get basic Windows system info: OS version, hostname, CPU model, total RAM (GB), uptime. Read-only.',
  parameters: { type: 'object', properties: {}, required: [] },

  async execute(): Promise<ToolResult> {
    const cpus = os.cpus();
    const info = {
      hostname: os.hostname(),
      osCaption: os.version(),       // p.ej. "Windows 10 Pro"
      osVersion: os.release(),       // p.ej. "10.0.19045"
      platform: os.platform(),       // "win32"
      arch: os.arch(),               // "x64"
      cpu: cpus[0]?.model?.trim() ?? 'unknown',
      logicalProcessors: cpus.length,
      totalRamGB: round1(os.totalmem() / GB),
      freeRamGB: round1(os.freemem() / GB),
      uptimeHours: round1(os.uptime() / 3600),
    };
    return { success: true, output: JSON.stringify(info) };
  },
};

registerTool(tool);
export default tool;
