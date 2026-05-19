import axios from 'axios';
import * as dotenv from 'dotenv';
import { CloudResponse, SwarmMissionPayload, LLMChatPayload, N8nWorkflowPayload } from './types.js';
import { interruptibleApiCall } from './credential_pool.js';

dotenv.config();

export class OpenGravityClient {
  private static getBaseUrl(): string {
    return process.env.OPENGRAVITY_URL || 'http://localhost:9900';
  }

  private static getApiKey(): string {
    return process.env.SHINOBI_API_KEY || '';
  }

  private static getHeaders() {
    return {
      'Content-Type': 'application/json',
      'X-Shinobi-Key': this.getApiKey()
    };
  }

  public static async checkHealth(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.getBaseUrl()}/v1/health`, { timeout: 3000 });
      return response.status === 200 && response.data.status === 'online';
    } catch (e) {
      return false;
    }
  }

  public static async startSwarmMission(mission_prompt: string, context?: Record<string, any>): Promise<CloudResponse> {
    try {
      const payload: SwarmMissionPayload = { mission_prompt, context };
      const response = await interruptibleApiCall(
        'opengravity',
        `${this.getBaseUrl()}/v1/missions/swarm`,
        payload,
        (key) => ({
          headers: {
            'Content-Type': 'application/json',
            'X-Shinobi-Key': key
          }
        }),
        30000, // timeout for swarm init
        3 // retries
      );
      return response.data;
    } catch (e: any) {
      if (e.message?.includes('No quedan credenciales')) {
        return { success: false, output: '', error: 'HTTP 401: Unauthorized API Key (Pool exhausted)' };
      }
      return { success: false, output: '', error: `Connection error: ${e.message}` };
    }
  }

  public static async invokeLLM(payload: LLMChatPayload): Promise<CloudResponse> {
    try {
      const timeoutMs = Number(process.env.OPENGRAVITY_TIMEOUT_MS) || 60_000;
      const response = await interruptibleApiCall(
        'opengravity',
        `${this.getBaseUrl()}/v1/llm/chat`,
        payload,
        (key) => ({
          headers: {
            'Content-Type': 'application/json',
            'X-Shinobi-Key': key
          }
        }),
        timeoutMs,
        3
      );
      return response.data;
    } catch (e: any) {
      if (e.message?.includes('No quedan credenciales')) {
        return { success: false, output: '', error: 'HTTP 401: Unauthorized API Key (Pool exhausted)' };
      }
      return { success: false, output: '', error: `Connection error: ${e.message}` };
    }
  }

  public static async invokeWorkflow(workflowId: string, inputs: Record<string, any>): Promise<CloudResponse> {
    try {
      const payload: N8nWorkflowPayload = { inputs };
      const timeoutMs = Number(process.env.OPENGRAVITY_TIMEOUT_MS) || 60_000;
      const response = await interruptibleApiCall(
        'opengravity',
        `${this.getBaseUrl()}/v1/n8n/workflow/${workflowId}`,
        payload,
        (key) => ({
          headers: {
            'Content-Type': 'application/json',
            'X-Shinobi-Key': key
          }
        }),
        timeoutMs,
        3
      );
      return response.data;
    } catch (e: any) {
      if (e.message?.includes('No quedan credenciales')) {
        return { success: false, output: '', error: 'HTTP 401: Unauthorized API Key (Pool exhausted)' };
      }
      return { success: false, output: '', error: `Connection error: ${e.message}` };
    }
  }
}
