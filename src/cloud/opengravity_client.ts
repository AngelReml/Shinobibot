import axios from 'axios';
import * as dotenv from 'dotenv';
import { CloudResponse, SwarmMissionPayload, LLMChatPayload, N8nWorkflowPayload } from './types.js';

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
      const response = await axios.post<CloudResponse>(
        `${this.getBaseUrl()}/v1/missions/swarm`, 
        payload, 
        { headers: this.getHeaders() }
      );
      return response.data;
    } catch (e: any) {
      if (e.response && e.response.status === 401) {
        return { success: false, output: '', error: 'HTTP 401: Unauthorized API Key' };
      }
      return { success: false, output: '', error: `Connection error: ${e.message}` };
    }
  }

  public static async invokeLLM(payload: LLMChatPayload): Promise<CloudResponse> {
    try {
      const response = await axios.post<CloudResponse>(
        `${this.getBaseUrl()}/v1/llm/chat`, 
        payload, 
        { headers: this.getHeaders() }
      );
      return response.data;
    } catch (e: any) {
      if (e.response && e.response.status === 401) {
        return { success: false, output: '', error: 'HTTP 401: Unauthorized API Key' };
      }
      return { success: false, output: '', error: `Connection error: ${e.message}` };
    }
  }

  public static async invokeWorkflow(workflowId: string, inputs: Record<string, any>): Promise<CloudResponse> {
    try {
      const payload: N8nWorkflowPayload = { inputs };
      const response = await axios.post<CloudResponse>(
        `${this.getBaseUrl()}/v1/n8n/workflow/${workflowId}`, 
        payload, 
        { headers: this.getHeaders() }
      );
      return response.data;
    } catch (e: any) {
      if (e.response && e.response.status === 401) {
        return { success: false, output: '', error: 'HTTP 401: Unauthorized API Key' };
      }
      return { success: false, output: '', error: `Connection error: ${e.message}` };
    }
  }

  public static async listSkills(): Promise<CloudResponse> {
    try {
      const response = await axios.get<CloudResponse>(
        `${this.getBaseUrl()}/v1/skills/list`, 
        { headers: this.getHeaders() }
      );
      return response.data;
    } catch (e: any) {
      if (e.response && e.response.status === 401) {
        return { success: false, output: '', error: 'HTTP 401: Unauthorized API Key' };
      }
      return { success: false, output: '', error: `Connection error: ${e.message}` };
    }
  }
}
