// record-my-session — composite. Dispatches start/stop to H1 and H2 skill modules.
import startSkill from '../../../desktop/desktop-obs-record-self/scripts/skill.mjs';
import stopSkill from '../../../desktop/desktop-obs-stop-and-save/scripts/skill.mjs';
import { registerTool } from '../../../../src/tools/tool_registry.js';

const tool = {
  name: 'record_my_session',
  description: 'Bracket a Shinobi session with OBS recording. action=start|stop.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['start', 'stop'] },
      with_microphone: { type: 'boolean', default: false },
      host: { type: 'string', default: '127.0.0.1' },
      port: { type: 'number', default: 4455 },
      password: { type: 'string', default: '' },
    },
    required: ['action'],
  },
  async execute(args = {}) {
    if (args.action === 'start') {
      const r = await startSkill.execute({ with_microphone: args.with_microphone, host: args.host, port: args.port, password: args.password });
      if (!r.success) return r;
      return { success: true, output: JSON.stringify({ ...JSON.parse(r.output), action: 'start' }), error: '' };
    }
    if (args.action === 'stop') {
      const r = await stopSkill.execute({ host: args.host, port: args.port, password: args.password });
      if (!r.success) return r;
      return { success: true, output: JSON.stringify({ ...JSON.parse(r.output), action: 'stop' }), error: '' };
    }
    return { success: false, output: '', error: `unknown action: ${args.action}` };
  },
};

registerTool(tool);
export default tool;
