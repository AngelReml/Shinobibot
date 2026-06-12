/**
 * Disk Usage — espacio libre por drive. Útil para advertir antes de
 * escrituras grandes o instalaciones.
 *
 * Implementación NATIVA (`fs.statfs`, Node 18.15+). NO lanza PowerShell
 * ni consulta `Win32_LogicalDisk`: la consulta WMI de discos, encadenada
 * con SO/red/procesos, es parte de la firma de recon que el ATC del
 * antivirus puntúa. Probamos letras C:..Z: con statfs en-proceso y nos
 * quedamos con las que existen. (Se pierde el `label` del volumen, que no
 * expone Node nativo.)
 */
import { statfs } from 'node:fs/promises';
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';

const GB = 1024 ** 3;
const round1 = (n: number): number => Math.round(n * 10) / 10;

const tool: Tool = {
  name: 'disk_usage',
  description: 'List Windows logical drives with total size, free space and percentage used. Read-only.',
  parameters: { type: 'object', properties: {}, required: [] },

  async execute(): Promise<ToolResult> {
    const drives: Array<Record<string, unknown>> = [];
    // 'C' (67) .. 'Z' (90). Evitamos A:/B: (disquetera) para no despertar
    // lectores de medios extraíbles vacíos.
    for (let code = 67; code <= 90; code++) {
      const letter = String.fromCharCode(code);
      try {
        const s = await statfs(`${letter}:\\`);
        const total = s.blocks * s.bsize;
        if (total <= 0) continue;
        const free = s.bavail * s.bsize;
        drives.push({
          drive: `${letter}:`,
          totalGB: round1(total / GB),
          freeGB: round1(free / GB),
          usedPct: round1(((total - free) / total) * 100),
        });
      } catch {
        // La unidad no existe / no está montada → la saltamos.
      }
    }
    return { success: true, output: JSON.stringify(drives) };
  },
};

registerTool(tool);
export default tool;
