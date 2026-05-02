export interface CloudResponse<T = string> {
  success: boolean;
  output: T;
  error: string;
  trace_id?: string;
}

export interface SwarmMissionPayload {
  mission_prompt: string;
  context?: Record<string, any>;
}

export interface LLMChatPayload {
  messages: any[];
  model?: string;
  tools?: any[];
}

export interface N8nWorkflowPayload {
  inputs: Record<string, any>;
}
