// FIX 1.12 — Se elimina el dotenv.config({override:true}) que se ejecutaba
// como side-effect al importar este módulo, contaminando el entorno de todos
// los importadores. La carga de .env es responsabilidad del entrypoint
// (scripts/shinobi.ts / scripts/shinobi_web.ts), no de un módulo interno.
import axios from 'axios';

/** Timeout de las llamadas HTTP al proveedor LLM. Sin esto, un proveedor
 *  colgado bloquea al caller (reader/llm_adapter) indefinidamente. */
const LLM_TIMEOUT_MS = Number(process.env.SHINOBI_LLM_TIMEOUT_MS) || 60_000;

export interface LLMConfig {
  provider: 'ollama' | 'groq' | 'openai';
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
}

export class LLMGateway {
  defaultGroqApiKey = process.env.GROQ_API_KEY;
  defaultOllamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  defaultOpenAIApiKey = process.env.OPENAI_API_KEY;

  async chat(messages: any[], config: LLMConfig) {
    const isLocal = config.baseUrl?.includes('localhost') || config.baseUrl?.includes('127.0.0.1');
    const provider = config.provider || (isLocal ? 'ollama' : 'openai');

    if (provider === 'openai') {
      const apiKey = config.apiKey || this.defaultOpenAIApiKey;
      const baseUrl = config.baseUrl || 'https://api.openai.com/v1/chat/completions';
      return this.openAIChat(messages, config.model || 'gpt-4o', apiKey, baseUrl, config.temperature);
    }

    if (provider === 'groq' && !isLocal) {
      const apiKey = config.apiKey || this.defaultGroqApiKey;
      const baseUrl = config.baseUrl || 'https://api.groq.com/openai/v1/chat/completions';
      return this.groqChat(messages, config.model || 'llama-3.3-70b-versatile', apiKey, baseUrl, config.temperature);
    }

    const baseUrl = config.baseUrl || this.defaultOllamaUrl;
    return this.ollamaChat(messages, config.model || 'qwen2.5-coder', baseUrl, config.temperature);
  }

  private async openAIChat(messages: any[], model: string, apiKey: string | undefined, baseUrl: string, temperature?: number) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const body: Record<string, unknown> = { model, messages };
    if (temperature !== undefined) body.temperature = temperature;
    const response = await axios.post(baseUrl, body, { headers, timeout: LLM_TIMEOUT_MS });
    return response.data.choices[0].message.content;
  }

  private async groqChat(messages: any[], model: string, apiKey: string | undefined, baseUrl: string, temperature?: number) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const body: Record<string, unknown> = { model, messages };
    if (temperature !== undefined) body.temperature = temperature;
    const response = await axios.post(baseUrl, body, { headers, timeout: LLM_TIMEOUT_MS });
    return response.data.choices[0].message.content;
  }

  private async ollamaChat(messages: any[], model: string, baseUrl: string, temperature?: number) {
    const body: Record<string, unknown> = { model, messages, stream: false };
    if (temperature !== undefined) body.options = { temperature };
    const response = await axios.post(`${baseUrl}/api/chat`, body, { timeout: LLM_TIMEOUT_MS });
    return response.data.message.content;
  }
}
