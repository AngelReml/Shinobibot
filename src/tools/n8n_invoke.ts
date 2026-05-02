import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { OpenGravityClient } from '../cloud/opengravity_client.js';

const n8nInvokeTool: Tool = {
  name: 'n8n_invoke',
  description: 'Invokes a pre-built n8n workflow from the OpenGravity catalog. Use this for tasks that involve external services like Slack, Gmail, Notion, Telegram, Google Sheets, scrapers, ETL pipelines. To discover available workflows, call n8n_list_catalog first.',
  parameters: {
    type: 'object',
    properties: {
      workflow_id: { type: 'string', description: 'The ID of the workflow in the catalog (e.g., "echo-pilot")' },
      inputs: { type: 'object', description: 'Inputs object passed to the workflow as POST body' }
    },
    required: ['workflow_id']
  },

  async execute(args: { workflow_id: string; inputs?: any }): Promise<ToolResult> {
    try {
      const result = await OpenGravityClient.invokeWorkflow(args.workflow_id, args.inputs || {});
      if (!result.success) {
        return { success: false, output: '', error: result.error || 'Workflow invocation failed' };
      }
      return { success: true, output: result.output };
    } catch (err: any) {
      return { success: false, output: '', error: `n8n_invoke error: ${err.message}` };
    }
  }
};

registerTool(n8nInvokeTool);
export default n8nInvokeTool;
