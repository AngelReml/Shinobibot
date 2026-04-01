import { LLMGateway, type LLMConfig } from '../gateway/llm.ts';
import { Memory } from '../db/memory.ts';
import { SYSTEM_PROMPT } from '../constants/prompts.ts';
import { UNDERCOVER_RULES } from '../utils/undercover.ts';

export class Orchestrator {
  private readonly gateway: LLMGateway;
  private readonly memory: Memory;

  constructor() {
    this.gateway = new LLMGateway();
    this.memory = new Memory();
  }

  async executeTask(task: string, config: LLMConfig) {
    console.log(`[Shinobibot] Starting task: ${task}`);
    
    const systemPrompt = `${SYSTEM_PROMPT}\n${UNDERCOVER_RULES}`;
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task }
    ];

    await this.memory.addMessage('user', task);

    const modelLabel = config.model || 'default';
    console.log(`[Shinobibot] Routing to ${config.provider} (${modelLabel})...`);
    
    const response = await this.gateway.chat(messages, config);
    await this.memory.addMessage('assistant', response);

    return response;
  }
}
