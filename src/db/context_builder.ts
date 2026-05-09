import OpenAI from 'openai';
import { SYSTEM_PROMPT } from '../constants/prompts.js';
import { Memory } from '../db/memory.js';

/**
 * Drop orphan tool messages and strip dangling assistant.tool_calls before
 * sending the conversation to the LLM. Some providers (notably Anthropic via
 * OpenRouter) reject any `tool_result` whose matching `tool_use` is missing
 * from the previous assistant message — typically a side-effect of the
 * 30-message window in `Memory` truncating mid tool exchange.
 *
 * Rules:
 *   - A `role:'tool'` message survives only if its `tool_call_id` matches a
 *     pending id from the most recent `assistant.tool_calls`.
 *   - When we move past a tool exchange (next non-tool message arrives), any
 *     pending ids that were never resolved are stripped from the assistant's
 *     `tool_calls` array (which itself is removed if it becomes empty, and
 *     the whole assistant message is dropped if it then has no content left).
 */
export function sanitizeToolSequence(history: any[]): any[] {
  const out: any[] = [];
  let pendingIds = new Set<string>();
  let lastAssistantIdx = -1;

  const stripUnresolvedFromLastAssistant = () => {
    if (pendingIds.size === 0 || lastAssistantIdx < 0) return;
    const a = out[lastAssistantIdx];
    if (a?.tool_calls && Array.isArray(a.tool_calls)) {
      const remaining = a.tool_calls.filter((tc: any) => !pendingIds.has(tc.id));
      if (remaining.length === 0) {
        const { tool_calls, ...rest } = a;
        if (!rest.content || (typeof rest.content === 'string' && rest.content.trim() === '')) {
          out.splice(lastAssistantIdx, 1);
        } else {
          out[lastAssistantIdx] = rest;
        }
      } else {
        out[lastAssistantIdx] = { ...a, tool_calls: remaining };
      }
    }
    pendingIds.clear();
    lastAssistantIdx = -1;
  };

  for (const msg of history) {
    if (msg.role === 'tool') {
      const id = msg.tool_call_id;
      if (id && pendingIds.has(id)) {
        out.push(msg);
        pendingIds.delete(id);
      }
      // else: orphan — drop silently
      continue;
    }

    stripUnresolvedFromLastAssistant();

    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      pendingIds = new Set(msg.tool_calls.map((tc: any) => tc.id));
      lastAssistantIdx = out.length;
    }

    out.push(msg);
  }

  stripUnresolvedFromLastAssistant();
  return out;
}

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

    const sanitized = sanitizeToolSequence(formattedHistory);

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...sanitized,
      { role: 'user', content: userInput }
    ];

    return messages;
  }
}
