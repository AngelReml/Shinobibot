import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import axios from 'axios';

const skillRequestTool: Tool = {
  name: 'request_new_skill',
  description: 'Asks OpenGravity to generate a brand new tool/skill from a natural-language description. The skill is NOT automatically activated — it goes into the catalog with status verified or unverified, and the human user must approve it manually with /skill approve <id>. Use this ONLY when no existing skill or tool can solve the task.',
  parameters: {
    type: 'object',
    properties: {
      capability_description: { type: 'string', description: 'Clear description of what the skill should do, including expected inputs and outputs.' },
      example_input: { type: 'object', description: 'Optional example of input.' },
      example_output: { type: 'object', description: 'Optional example of expected output.' },
      context: { type: 'string', description: 'Optional extra context for the generator.' }
    },
    required: ['capability_description']
  },
  async execute(args: any): Promise<ToolResult> {
    try {
      const baseUrl = process.env.OPENGRAVITY_URL || 'http://localhost:9900';
      const apiKey = process.env.SHINOBI_API_KEY || '';
      const r = await axios.post(`${baseUrl}/v1/skills/generate`, {
        capability_description: args.capability_description,
        example_input: args.example_input,
        example_output: args.example_output,
        context: args.context,
        visibility: 'private'
      }, {
        headers: { 'X-Shinobi-Key': apiKey, 'Content-Type': 'application/json' },
        timeout: 120000
      });
      if (!r.data.success) return { success: false, output: '', error: r.data.error || 'generation failed' };
      const parsed = JSON.parse(r.data.output);
      return {
        success: true,
        output: `Skill generated successfully. ID: ${parsed.id}. Name: ${parsed.name}. Status: ${parsed.status}. Lint: ${parsed.validation?.lint_passed}, Compile: ${parsed.validation?.compile_passed}, Sandbox: ${parsed.validation?.sandbox_passed}. The user must run "/skill approve ${parsed.id}" to enable it. The skill is NOT yet usable.`
      };
    } catch (e: any) {
      return { success: false, output: '', error: `request_new_skill error: ${e.message}` };
    }
  }
};
registerTool(skillRequestTool);
export default skillRequestTool;
