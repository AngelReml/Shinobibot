/**
 * Kernel Mission Tool — Start a Swarm Mission on the OpenGravity Kernel
 */
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { KernelClient } from '../bridge/kernel_client.js';

const kernelMissionTool: Tool = {
  name: 'start_kernel_mission',
  description: 'Sends a complex mission or heavy research task to the OpenGravity Kernel for isolated execution (Swarm). Use this when a task requires long processing, isolated Python execution (sandboxing), or self-evaluation and testing.',
  parameters: {
    type: 'object',
    properties: {
      mission_prompt: { type: 'string', description: 'The detailed description of the investigation or task to be executed by the kernel' },
    },
    required: ['mission_prompt'],
  },

  async execute(args: { mission_prompt: string }): Promise<ToolResult> {
    try {
      console.log(`\n[📡] Connecting to OpenGravity Kernel...`);
      const isOnline = await KernelClient.isOnline();
      
      if (!isOnline) {
        return { 
          success: false, 
          output: '', 
          error: 'Connection to OpenGravity Kernel failed. Kernel appears to be offline. Fallback to local mode.' 
        };
      }

      console.log(`[🚀] Launching mission on Kernel: ${args.mission_prompt.substring(0, 50)}...`);
      const result = await KernelClient.startMission(args.mission_prompt);
      
      if (!result.success) {
         return {
             success: false,
             output: '',
             error: `Mission launch failed: ${result.error}`,
         };
      }

      const missionId = result.missionId || 'unknown-id';
      console.log(`[⏳] Mission ${missionId} started. Waiting for completion...`);
      
      // Wait for mission to finish
      const finalResult = await KernelClient.waitForMission(missionId);
      
      if (finalResult.success && finalResult.status === 'completed') {
           return {
               success: true,
               output: `Mission ${missionId} Completed Successfully.\nStatus: ${finalResult.status}\nLogs:\n${(finalResult.logs || []).join('\n')}`,
           };
      } else {
           return {
               success: false,
               output: '',
               error: `Mission ${missionId} failed or was cancelled.\nLogs:\n${(finalResult.logs || []).join('\n')}`,
           };
      }
      
    } catch (err: any) {
       return { success: false, output: '', error: `Kernel mission tool error: ${err.message}` };
    }
  },
};

registerTool(kernelMissionTool);
export default kernelMissionTool;
