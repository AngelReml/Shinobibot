// desktop-outlook-send-email — Node entry. Encodes args as JSON to PS1.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { registerTool } from '../../../../src/tools/tool_registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PS1 = join(__dirname, 'send.ps1');

const tool = {
  name: 'desktop_outlook_send_email',
  description: 'Send an email through the local Outlook desktop client. Windows only. Sends real mail unless display=true.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string' },
      subject: { type: 'string' },
      body: { type: 'string' },
      html: { type: 'boolean', default: false },
      cc: { type: 'string' },
      bcc: { type: 'string' },
      attachments: { type: 'array', items: { type: 'string' } },
      display: { type: 'boolean', default: false, description: 'If true, opens compose window without sending' },
    },
    required: ['to', 'subject', 'body'],
  },
  async execute(args) {
    if (!args || !args.to || !args.subject || !args.body) {
      return { success: false, output: '', error: 'to, subject and body are required' };
    }
    if (process.platform !== 'win32') return { success: false, output: '', error: 'Windows-only skill' };
    if (!existsSync(PS1)) return { success: false, output: '', error: `helper missing: ${PS1}` };
    const r = spawnSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1, JSON.stringify(args)],
      { encoding: 'utf-8', timeout: 60_000 },
    );
    if (r.error) return { success: false, output: '', error: `spawn error: ${r.error.message}` };
    const stdout = (r.stdout || '').trim();
    if (!stdout) return { success: false, output: '', error: `no output (exit=${r.status}); stderr=${(r.stderr || '').slice(0, 400)}` };
    try {
      const parsed = JSON.parse(stdout);
      if (parsed.success === false) return { success: false, output: '', error: parsed.error ?? 'send failed' };
      return { success: true, output: JSON.stringify(parsed), error: '' };
    } catch (e) {
      return { success: false, output: '', error: `json parse failed: ${e.message}` };
    }
  },
};

registerTool(tool);
export default tool;
