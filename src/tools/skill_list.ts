import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import axios from 'axios';

const skillListTool: Tool = {
  name: 'skill_list',
  description: 'Lists skills available in the OpenGravity catalog (private to this Shinobi + public). Use this BEFORE asking to generate a new skill — maybe one already exists.',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['unverified', 'verified', 'promoted', 'rejected'], description: 'Optional filter by status' }
    }
  },
  async execute(args: { status?: string }): Promise<ToolResult> {
    try {
      const baseUrl = process.env.OPENGRAVITY_URL || 'http://localhost:9900';
      const apiKey = process.env.SHINOBI_API_KEY || '';
      const params = args.status ? `?status=${args.status}` : '';
      const r = await axios.get(`${baseUrl}/v1/skills/list${params}`, {
        headers: { 'X-Shinobi-Key': apiKey },
        timeout: 10000
      });
      if (!r.data.success) return { success: false, output: '', error: r.data.error || 'list failed' };
      return { success: true, output: r.data.output };
    } catch (e: any) {
      return { success: false, output: '', error: `skill_list error: ${e.message}` };
    }
  }
};
registerTool(skillListTool);
export default skillListTool;
