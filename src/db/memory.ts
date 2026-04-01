import fs from 'fs';
import path from 'path';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export class Memory {
  private filePath: string;

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

  async addMessage(role: ChatMessage['role'], content: string) {
    const messages = await this.getMessages(1000);
    const newMessage: ChatMessage = {
      role,
      content,
      timestamp: new Date().toISOString()
    };
    messages.push(newMessage);
    fs.writeFileSync(this.filePath, JSON.stringify(messages, null, 2));
  }

  async getMessages(limit: number = 20): Promise<ChatMessage[]> {
    try {
      const data = fs.readFileSync(this.filePath, 'utf-8');
      const messages = JSON.parse(data) as ChatMessage[];
      return messages.slice(-limit);
    } catch (error) {
      console.error("[Memory] Error reading memory file:", error);
      return [];
    }
  }

  async clear() {
    fs.writeFileSync(this.filePath, JSON.stringify([], null, 2));
  }
}
