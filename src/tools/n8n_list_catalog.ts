import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { OpenGravityClient } from '../cloud/opengravity_client.js';
import axios from 'axios';

const n8nListCatalogTool: Tool = {
  name: 'n8n_list_catalog',
  description: 'Lists all n8n workflows available in the OpenGravity catalog (public + owned by this key). Returns array of {id, description, tags, visibility}.',
  parameters: { type: 'object', properties: {} },

  async execute(): Promise<ToolResult> {
    try {
      const baseUrl = process.env.OPENGRAVITY_URL || 'http://localhost:9900';
      const apiKey = process.env.SHINOBI_API_KEY || '';
      const r = await axios.get(`${baseUrl}/v1/n8n/catalog`, {
        headers: { 'X-Shinobi-Key': apiKey },
        timeout: 10000
      });
      if (!r.data.success) {
        return { success: false, output: '', error: r.data.error || 'Catalog fetch failed' };
      }
      return { success: true, output: r.data.output };
    } catch (err: any) {
      return { success: false, output: '', error: `n8n_list_catalog error: ${err.message}` };
    }
  }
};

registerTool(n8nListCatalogTool);
export default n8nListCatalogTool;
