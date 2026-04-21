import fs from 'fs';
import path from 'path';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  name?: string; // For tool calls
  tool_calls?: any[]; // For assistant tool calls
  tool_call_id?: string; // For tool message
  timestamp: string;
}

export class Memory {
  private filePath: string;
  private maxHistory: number = 30; // Limit history to prevent context overflow

  constructor(filePath: string = './memory.json') {
    this.filePath = path.resolve(filePath);
    this.init();
  }

  private init() {
    if (!fs.existsSync(this.filePath)) {
      console.log(`[Memory] Initializing new memory file at ${this.filePath}`);
      fs.writeFileSync(this.filePath, JSON.stringify([], null, 2));
    }
  }

  async addMessage(msg: Omit<ChatMessage, 'timestamp'>) {
    let messages = await this.getMessages(this.maxHistory * 2); // Get more so we can compress if needed
    
    const newMessage: ChatMessage = {
      ...msg,
      timestamp: new Date().toISOString()
    };

    // Simple deduplication for exact rapid consecutive user messages (like the JWT example)
    const lastMsg = messages[messages.length - 1];
    if (
        lastMsg && 
        lastMsg.role === 'user' && 
        newMessage.role === 'user' && 
        lastMsg.content === newMessage.content
    ) {
        // Skip duplicate
        return;
    }

    messages.push(newMessage);

    // Naive truncation for now (keep last maxHistory messages)
    // A robust system (like Phase 3) would use the LLM to summarize older messages.
    if (messages.length > this.maxHistory) {
      messages = messages.slice(-this.maxHistory);
    }

    fs.writeFileSync(this.filePath, JSON.stringify(messages, null, 2));
  }

  async getMessages(limit?: number): Promise<ChatMessage[]> {
    try {
      const data = fs.readFileSync(this.filePath, 'utf-8');
      let messages = JSON.parse(data) as ChatMessage[];
      if (limit) {
         messages = messages.slice(-limit);
      }
      return messages;
    } catch (error) {
      console.error("[Memory] Error reading memory file:", error);
      return [];
    }
  }

  async clear() {
    fs.writeFileSync(this.filePath, JSON.stringify([], null, 2));
  }
}
