/**
 * Clipboard Read — lee el contenido actual del portapapeles de Windows.
 */
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { runPowerShell } from './_powershell.js';

const tool: Tool = {
  name: 'clipboard_read',
  description: 'Read the current text content from the Windows clipboard. Returns whatever was last copied (Ctrl+C). No args required.',
  parameters: { type: 'object', properties: {}, required: [] },

  async execute(): Promise<ToolResult> {
    const r = await runPowerShell('Get-Clipboard -Raw');
    if (!r.success) {
      return { success: false, output: '', error: r.stderr || `PowerShell exited ${r.exitCode}` };
    }
    return { success: true, output: r.stdout.replace(/\r\n$/, '') };
  },
};

registerTool(tool);
export default tool;
