import OpenAI from 'openai';
import { SYSTEM_PROMPT } from '../constants/prompts.js';
import { Memory } from '../db/memory.js';

export class ContextBuilder {
  private memory: Memory;

  constructor() {
    this.memory = new Memory();
  }

  async buildMessages(userInput: string): Promise<any[]> {
    const rawHistory = await this.memory.getMessages();
    
    // Map internal history to OpenAI format
    const formattedHistory = rawHistory.map(msg => {
       const mapped: any = {
           role: msg.role,
           content: msg.content,
       };
       if (msg.name) mapped.name = msg.name;
       if (msg.tool_calls) mapped.tool_calls = msg.tool_calls;
       if (msg.tool_call_id) mapped.tool_call_id = msg.tool_call_id;
       return mapped;
    });

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...formattedHistory,
      { role: 'user', content: userInput }
    ];

    return messages;
  }
}
