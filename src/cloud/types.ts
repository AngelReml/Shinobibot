export interface LLMUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface CloudResponse<T = string> {
  success: boolean;
  output: T;
  error: string;
  trace_id?: string;
  usage?: LLMUsage;
  resolvedProvider?: string;
}

export interface SwarmMissionPayload {
  mission_prompt: string;
  context?: Record<string, any>;
}

export interface LLMChatPayload {
  messages: any[];
  model?: string;
  tools?: any[];
  tool_choice?: any;
  temperature?: number;
  max_tokens?: number;
}

export interface N8nWorkflowPayload {
  inputs: Record<string, any>;
}
