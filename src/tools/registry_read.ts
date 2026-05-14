/**
 * Registry Read — lee valores del Registro de Windows con allowlist
 * estricta sobre las hives permitidas. Read-only por definición.
 *
 * Política:
 *   - Solo HKLM:\, HKCU:\, HKCR:\, HKU:\, HKCC:\ son aceptadas.
 *   - Se rechaza cualquier intento de path traversal o referencia a
 *     hives no documentadas.
 *   - No hay escritura — para eso el LLM debe pedir al usuario
 *     manualmente.
 */
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { runPowerShell, psLit, tryParseJson } from './_powershell.js';

const ALLOWED_HIVES = ['HKLM:', 'HKCU:', 'HKCR:', 'HKU:', 'HKCC:'];

function isAllowedRegistryPath(p: string): { ok: boolean; reason?: string } {
  const trimmed = p.trim();
  if (!trimmed) return { ok: false, reason: 'path vacío' };
  const upper = trimmed.toUpperCase();
  // El primer segmento debe ser una hive de la allowlist.
  const matches = ALLOWED_HIVES.some(h => upper.startsWith(h + '\\') || upper === h);
  if (!matches) {
    return { ok: false, reason: `solo se aceptan hives ${ALLOWED_HIVES.join(', ')}` };
  }
  // No permitir comillas sueltas dentro del path (defensa extra).
  if (/['"`]/.test(trimmed)) {
    return { ok: false, reason: 'el path no puede contener comillas' };
  }
  return { ok: true };
}

const tool: Tool = {
  name: 'registry_read',
  description: 'Read a Windows registry key value. Allowed hives: HKLM:, HKCU:, HKCR:, HKU:, HKCC:. Read-only — use this to inspect software config, but never to modify.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Registry path, e.g. "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion".' },
      name: { type: 'string', description: 'Optional: specific value name within the key. If omitted, lists all values of the key.' },
    },
    required: ['path'],
  },

  async execute(args: { path: string; name?: string }): Promise<ToolResult> {
    const guard = isAllowedRegistryPath(args.path);
    if (!guard.ok) {
      return { success: false, output: '', error: `Registry path rechazado: ${guard.reason}` };
    }
    const pathLit = psLit(args.path);
    const nameLit = args.name ? psLit(args.name) : '';
    const script = args.name
      ? `(Get-ItemProperty -Path ${pathLit} -Name ${nameLit} -ErrorAction Stop) | ` +
        `Select-Object -ExpandProperty ${nameLit} | ConvertTo-Json -Compress`
      : `(Get-ItemProperty -Path ${pathLit} -ErrorAction Stop) | ` +
        `Select-Object * -ExcludeProperty PSPath,PSParentPath,PSChildName,PSDrive,PSProvider | ` +
        `ConvertTo-Json -Compress`;
    const r = await runPowerShell(script);
    if (!r.success) {
      return { success: false, output: '', error: (r.stderr || `PowerShell exited ${r.exitCode}`).trim() };
    }
    const parsed = tryParseJson(r.stdout);
    return { success: true, output: parsed != null ? JSON.stringify(parsed) : r.stdout.trim() };
  },
};

registerTool(tool);
export default tool;
export { isAllowedRegistryPath };
