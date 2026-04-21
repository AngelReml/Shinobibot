import fs from 'fs';
import path from 'path';
export class Memory {
    filePath;
    constructor(filePath = './memory.json') {
        this.filePath = path.resolve(filePath);
        this.init();
    }
    init() {
        if (!fs.existsSync(this.filePath)) {
            console.log(`[Memory] Initializing new memory file at ${this.filePath}`);
            fs.writeFileSync(this.filePath, JSON.stringify([], null, 2));
        }
    }
    async addMessage(role, content) {
        const messages = await this.getMessages(1000);
        const newMessage = {
            role,
            content,
            timestamp: new Date().toISOString()
        };
        messages.push(newMessage);
        fs.writeFileSync(this.filePath, JSON.stringify(messages, null, 2));
    }
    async getMessages(limit = 20) {
        try {
            const data = fs.readFileSync(this.filePath, 'utf-8');
            const messages = JSON.parse(data);
            return messages.slice(-limit);
        }
        catch (error) {
            console.error("[Memory] Error reading memory file:", error);
            return [];
        }
    }
    async clear() {
        fs.writeFileSync(this.filePath, JSON.stringify([], null, 2));
    }
}
