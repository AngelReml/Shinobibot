import OpenAI from 'openai';
import { OpenGravityClient } from '../cloud/opengravity_client.js';
import { invokeLLMViaOpenRouter, isConnectionError } from '../cloud/openrouter_fallback.js';
import { getAllTools, getTool, toOpenAITools } from '../tools/index.js';
import { Memory } from '../db/memory.js';
import { ContextBuilder } from '../db/context_builder.js';
import { MemoryStore } from '../memory/memory_store.js';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../../.env'), override: true });

export type ExecutionMode = 'local' | 'kernel' | 'auto';

export class ShinobiOrchestrator {
  private static mode: ExecutionMode = 'kernel';
  private static memory = new Memory();
  private static contextBuilder = new ContextBuilder();
  private static memoryStore: MemoryStore | null = null;
  private static openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  private static activeModel: string | undefined = undefined;

  static getMemory(): MemoryStore { if (!this.memoryStore) this.memoryStore = new MemoryStore(); return this.memoryStore; }

  static setModel(model: string | undefined) { this.activeModel = model; }
  static getModel(): string { return this.activeModel || 'default'; }

  static setMode(mode: ExecutionMode) {
    this.mode = mode;
    console.log(`[Shinobi] Mode set to: ${mode}`);
  }

  private static buildModeHint(): string | null {
    if (this.mode === 'local') {
      return 'You are operating in LOCAL mode. The OpenGravity Kernel is unavailable. Use only local tools to accomplish the task.';
    }
    if (this.mode === 'kernel') {
      return 'You are operating in KERNEL mode. When a task is complex, research-heavy, or requires isolated execution, prefer delegating to the OpenGravity Kernel using start_kernel_mission. For simple file reads or listings, local tools are still fine.';
    }
    return null;
  }

  static async process(input: string): Promise<any> {
    console.log(`[Shinobi] Processing: ${input.slice(0, 50)}...`);

    // Add user input to memory
    await this.memory.addMessage({ role: 'user', content: input });

    return this.executeToolLoop(input);
  }

  private static async executeToolLoop(input: string): Promise<any> {
    let currentMessages = await this.contextBuilder.buildMessages(input);

    const userQuery = currentMessages.filter(m => m.role === 'user').slice(-1)[0]?.content || '';
    if (userQuery && typeof userQuery === 'string') {
      try {
        const memSection = await ShinobiOrchestrator.getMemory().buildContextSection(userQuery, 1500);
        if (memSection) {
          currentMessages = [{ role: 'system', content: memSection } as any, ...currentMessages];
        }
      } catch (e) { console.error('[memory] context build failed:', (e as Error).message); }
    }

    const modeHint = this.buildModeHint();
    if (modeHint) {
      currentMessages = [{ role: 'system', content: modeHint }, ...currentMessages];
    }
    const allTools = getAllTools();
    const availableTools = this.mode === 'local'
      ? allTools.filter(t => t.name !== 'start_kernel_mission')
      : allTools;
    const openAITools = toOpenAITools(availableTools);

    let iteration = 0;
    const maxIterations = 10;

    while (iteration < maxIterations) {
      iteration++;
      console.log(`[Shinobi] Let the LLM decide (Iter ${iteration})...`);

      try {
        // [B2-DEPRECATED]
        /*
        const response = await this.openai.chat.completions.create({
          model: 'gpt-4o',
          messages: currentMessages,
          tools: openAITools.length > 0 ? openAITools : undefined,
          tool_choice: 'auto',
          temperature: 0.2,
        });
        const responseMessage = response.choices[0].message;
        */

        const llmPayload = {
          messages: currentMessages,
          model: this.activeModel,
          tools: openAITools.length > 0 ? openAITools : undefined,
          tool_choice: openAITools.length > 0 ? 'auto' : 'none',
          temperature: 0.2,
        };
        let result = await OpenGravityClient.invokeLLM(llmPayload);

        // FAIL 1 fallback: si el gateway 9900 está caído, reintentar contra
        // OpenRouter directo. Aplica simétricamente a CLI y Web (es la misma
        // capa). Log claro cuando se usa el fallback.
        if (!result.success && isConnectionError(result.error)) {
          console.log('[Shinobi] OpenGravity gateway offline, using OpenRouter direct fallback');
          result = await invokeLLMViaOpenRouter(llmPayload);
          if (result.success) {
            console.log('[Shinobi] OpenRouter fallback OK.');
          } else {
            console.log(`[Shinobi] OpenRouter fallback failed: ${result.error}`);
          }
        }

        if (!result.success) {
          throw new Error(`OpenGravity LLM Error: ${result.error}`);
        }

        const responseMessage = JSON.parse(result.output);

        // If the LLM just responds with text, we are done
        if (!responseMessage.tool_calls || responseMessage.tool_calls.length === 0) {
          await this.memory.addMessage({ role: 'assistant', content: responseMessage.content || '' });
          return {
            verdict: 'VALID_AGENT',
            mode: this.mode,
            response: responseMessage.content,
          };
        }

        // Add the LLM's message indicating tool calls to history
        currentMessages.push(responseMessage);
        await this.memory.addMessage({
          role: 'assistant',
          content: responseMessage.content || '',
          tool_calls: responseMessage.tool_calls as any,
        });

        // Execute all requested tool calls
        for (const toolCall of responseMessage.tool_calls) {
          if (toolCall.type !== 'function') continue;
          const functionName = toolCall.function.name;
          const functionArgs = JSON.parse(toolCall.function.arguments);
          console.log(`  [🔨] Tool called: ${functionName}`);

          const tool = getTool(functionName);
          let toolResultStr = '';

          if (!tool) {
            toolResultStr = JSON.stringify({ error: `Tool ${functionName} not found` });
          } else {
            console.log(`       Args: ${JSON.stringify(functionArgs).substring(0, 100)}...`);

            // Note: In a CLI interface, here is where we would prompt the user if tool.requiresConfirmation() is true.
            // For now, we auto-execute.

            const result = await tool.execute(functionArgs);
            toolResultStr = JSON.stringify(result);
            if (result.success) {
              console.log(`       ✅ Success`);
            } else {
              console.log(`       ❌ Failed: ${result.error}`);
            }
          }

          // Append tool response to messages
          const toolMessage = {
            role: 'tool' as const,
            tool_call_id: toolCall.id,
            name: functionName,
            content: toolResultStr,
          };
          currentMessages.push(toolMessage);

          await this.memory.addMessage({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: functionName,
            content: toolResultStr
          });
        }

        // Loop continues, feeding tool results back to LLM...

      } catch (error: any) {
        console.error(`[Shinobi] LLM or Tool Error: ${error.message}`);
        return {
          verdict: 'ERROR',
          error: error.message
        }
      }
    }

    return {
      verdict: 'MAX_ITERATIONS',
      error: 'Tool loop hit max iterations without generating a final response.'
    };
  }
}
