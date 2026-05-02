/**
 * Cloud Mission Tool — Start a Swarm Mission on OpenGravity
 */
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { OpenGravityClient } from '../cloud/opengravity_client.js';

const cloudMissionTool: Tool = {
  name: 'start_cloud_mission',
  description: 'Sends a complex mission or heavy research task to OpenGravity for isolated execution (Swarm) in the cloud. Use this when a task requires long processing or specialized agents.',
  parameters: {
    type: 'object',
    properties: {
      mission_prompt: { type: 'string', description: 'The detailed description of the investigation or task to be executed by the cloud swarm' },
    },
    required: ['mission_prompt'],
  },

  async execute(args: { mission_prompt: string }): Promise<ToolResult> {
    try {
      console.log(`\n[📡] Connecting to OpenGravity Cloud...`);
      const isOnline = await OpenGravityClient.checkHealth();
      
      if (!isOnline) {
        return { 
          success: false, 
          output: '', 
          error: 'Connection to OpenGravity failed. Cloud appears to be offline. Fallback to local mode.' 
        };
      }

      console.log(`[🚀] Launching mission on OpenGravity: ${args.mission_prompt.substring(0, 50)}...`);
      console.log(`[⏳] This might take a few minutes as the swarm executes...`);
      
      const result = await OpenGravityClient.startSwarmMission(args.mission_prompt);
      
      if (result.success) {
           return {
               success: true,
               output: `Cloud Mission Completed Successfully.\nOutput:\n${result.output}`,
           };
      } else {
           return {
               success: false,
               output: '',
               error: `Cloud Mission failed: ${result.error}`,
           };
      }
      
    } catch (err: any) {
       return { success: false, output: '', error: `Cloud mission tool error: ${err.message}` };
    }
  },
};

registerTool(cloudMissionTool);
export default cloudMissionTool;
