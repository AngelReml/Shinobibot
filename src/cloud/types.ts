export interface LLMUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** Tokens del prompt servidos desde la caché del proveedor (se cobran con descuento). Incluidos en prompt_tokens. */
  cache_read_tokens?: number;
  /** Tokens del prompt escritos en la caché (se cobran con recargo). Incluidos en prompt_tokens. */
  cache_write_tokens?: number;
}

export interface CloudResponse<T = string> {
  success: boolean;
  output: T;
  error: string;
  trace_id?: string;
  usage?: LLMUsage;
  resolvedProvider?: string;
  /** Modelo que respondió de verdad (el coste se calcula con su tarifa). */
  resolvedModel?: string;
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
