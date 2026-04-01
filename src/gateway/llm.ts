import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

export interface LLMConfig {
  provider: 'ollama' | 'groq';
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export class LLMGateway {
  private readonly defaultGroqApiKey = process.env.GROQ_API_KEY;
  private readonly defaultOllamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';

  async chat(messages: any[], config: LLMConfig) {
    const isLocal = config.baseUrl?.includes('localhost') || config.baseUrl?.includes('127.0.0.1');
    const provider = config.provider || (isLocal ? 'ollama' : 'groq');

    if (provider === 'groq' && !isLocal) {
      const apiKey = config.apiKey || this.defaultGroqApiKey;
      const baseUrl = config.baseUrl || 'https://api.groq.com/openai/v1/chat/completions';
      return this.groqChat(messages, config.model || 'llama-3-70b-versatile', apiKey, baseUrl);
    }
    
    const baseUrl = config.baseUrl || this.defaultOllamaUrl;
    return this.ollamaChat(messages, config.model || 'qwen2.5-coder', baseUrl);
  }

  private async groqChat(messages: any[], model: string, apiKey: string | undefined, baseUrl: string) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await axios.post(
      baseUrl,
      {
        model,
        messages,
      },
      { headers }
    );
    return response.data.choices[0].message.content;
  }

  private async ollamaChat(messages: any[], model: string, baseUrl: string) {
    const response = await axios.post(`${baseUrl}/api/chat`, {
      model,
      messages,
      stream: false,
    });
    return response.data.message.content;
  }
}
