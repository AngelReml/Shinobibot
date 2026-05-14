/**
 * Clipboard Write — establece el contenido del portapapeles de Windows.
 */
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { runPowerShell, psLit } from './_powershell.js';

const tool: Tool = {
  name: 'clipboard_write',
  description: 'Set the Windows clipboard to a given text value. After this, the user can paste it with Ctrl+V.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to copy to the clipboard.' },
    },
    required: ['text'],
  },

  async execute(args: { text: string }): Promise<ToolResult> {
    const script = `Set-Clipboard -Value ${psLit(args.text)}`;
    const r = await runPowerShell(script);
    if (!r.success) {
      return { success: false, output: '', error: r.stderr || `PowerShell exited ${r.exitCode}` };
    }
    return { success: true, output: `Clipboard set (${args.text.length} chars).` };
  },
};

registerTool(tool);
export default tool;
