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
  /**
   * Cola de escritura en proceso. addMessage hace read-modify-write; sin
   * serializar, dos llamadas async concurrentes producen lost-update. La
   * cadena garantiza que cada read-modify-write se ejecuta entera antes de
   * empezar la siguiente (bug C7 de la auditoría 2026-05-16).
   */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(filePath: string = './memory.json') {
    this.filePath = path.resolve(filePath);
    this.init();
  }

  private init() {
    if (!fs.existsSync(this.filePath)) {
      console.log(`[Memory] Initializing new memory file at ${this.filePath}`);
      this.atomicWrite([]);
    }
  }

  /**
   * Escritura atómica: escribe a un .tmp y renombra. rename es atómico en
   * el mismo volumen, así que un lector nunca ve un JSON a medias.
   */
  private atomicWrite(messages: ChatMessage[]): void {
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(messages, null, 2));
    fs.renameSync(tmp, this.filePath);
  }

  async addMessage(msg: Omit<ChatMessage, 'timestamp'>) {
    // Encadena el read-modify-write para que no se solape con otro.
    this.writeChain = this.writeChain.then(() => this.addMessageLocked(msg));
    return this.writeChain;
  }

  private async addMessageLocked(msg: Omit<ChatMessage, 'timestamp'>): Promise<void> {
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

    this.atomicWrite(messages);
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
    this.writeChain = this.writeChain.then(() => { this.atomicWrite([]); });
    return this.writeChain;
  }
}

const _sharedMemory = new Map<string, Memory>();

/**
 * Instancia COMPARTIDA de Memory por path.
 *
 * `addMessage` serializa los read-modify-write con `writeChain`, pero esa
 * cadena es por-instancia. Si dos partes del código hacen `new Memory()`
 * sobre el mismo `memory.json`, sus cadenas no se coordinan y el
 * lost-update del bug C7 reaparece ENTRE instancias. Todos los callers de
 * producción deben usar este singleton para compartir la misma cadena.
 */
export function sharedMemory(filePath: string = './memory.json'): Memory {
  const key = path.resolve(filePath);
  let m = _sharedMemory.get(key);
  if (!m) {
    m = new Memory(filePath);
    _sharedMemory.set(key, m);
  }
  return m;
}
