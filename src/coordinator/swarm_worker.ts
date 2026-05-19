import { TaskQueueStore, type TaskItem } from '../persistence/task_queue.js';
import { invokeLLM as routedInvokeLLM, currentProvider } from '../providers/provider_router.js';
import { getTool, toOpenAITools } from '../tools/index.js';
import { sanitizeToolCallArguments, repairMessageSequence } from '../runtime/trajectory_helpers.js';
import { capToolResultJson } from '../context/tool_output_truncator.js';
import { metrics } from '../observability/metrics.js';
import { calculateCost } from './orchestrator.js';

export class SwarmWorker {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    public readonly agentId: string,
    public readonly role: string,
    private readonly allowedTools: string[],
    private readonly queue: TaskQueueStore,
    private readonly systemPrompt: string,
    private readonly pollingIntervalMs: number = 5000
  ) {}

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.tick();
    console.log(`[SwarmWorker:${this.agentId}] Started polling for role '${this.role}' every ${this.pollingIntervalMs}ms`);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log(`[SwarmWorker:${this.agentId}] Stopped`);
  }

  private tick(): void {
    if (!this.isRunning) return;
    
    // We use setTimeout instead of setInterval to ensure we never overlap and cause race cascades
    this.timer = setTimeout(() => {
      this.processNextTask().finally(() => {
        if (this.isRunning) this.tick();
      });
    }, this.pollingIntervalMs);
  }

  private async processNextTask(): Promise<void> {
    let task: TaskItem | null = null;
    try {
      task = this.queue.claimNextTask(this.agentId, this.role);
      if (!task) return;

      console.log(`[SwarmWorker:${this.agentId}] Claimed task ${task.id} (Priority: ${task.priority})`);
      
      const result = await this.executeEphemeralLoop(task);
      this.queue.completeTask(task.id, result);
      console.log(`[SwarmWorker:${this.agentId}] Task ${task.id} completed successfully.`);
      
    } catch (err: any) {
      if (task) {
        console.error(`[SwarmWorker:${this.agentId}] Task ${task.id} failed:`, err.message);
        this.queue.failTask(task.id, err.message || 'Unknown error');
      } else {
        console.error(`[SwarmWorker:${this.agentId}] Loop error:`, err.message);
      }
    }
  }

  private async executeEphemeralLoop(task: TaskItem): Promise<string> {
    const messages: any[] = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: `TASK TITLE: ${task.title}\n\nDESCRIPTION: ${task.description || 'No description provided.'}\n\nPlease accomplish this task and output a final response when done.` }
    ];

    const tools = this.allowedTools.map(name => getTool(name)).filter(t => t !== undefined);
    const openAITools = toOpenAITools(tools);
    let iterations = 0;
    const MAX_ITERATIONS = 20;

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      
      const payload = {
        messages: repairMessageSequence(messages),
        tools: openAITools.length > 0 ? openAITools : undefined,
        tool_choice: openAITools.length > 0 ? 'auto' : 'none',
        temperature: 0.2,
      };

      const startTime = Date.now();
      const result = await routedInvokeLLM(payload);
      const durationMs = Date.now() - startTime;

      if (!result.success) {
        throw new Error(`LLM Error: ${result.error}`);
      }

      // Record Telemetry
      const resolvedProvider = result.resolvedProvider || currentProvider() || 'default';
      const resolvedModel = payload.tools ? 'model-with-tools' : 'model-standard';
      const callDurationSec = durationMs / 1000;
      const registry = metrics();

      registry.counterInc('shinobi_llm_calls_total', 1, { provider: resolvedProvider, model: resolvedModel, role: this.role });

      try {
        registry.histogramObserve('shinobi_llm_duration_seconds', callDurationSec, { provider: resolvedProvider, model: resolvedModel, role: this.role });
      } catch {
        registry.describeHistogram('shinobi_llm_duration_seconds', { buckets: [0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0] }, 'LLM call duration in seconds');
        registry.histogramObserve('shinobi_llm_duration_seconds', callDurationSec, { provider: resolvedProvider, model: resolvedModel, role: this.role });
      }

      if (result.usage) {
        registry.counterInc('shinobi_llm_tokens_total', result.usage.prompt_tokens, { provider: resolvedProvider, model: resolvedModel, type: 'prompt', role: this.role });
        registry.counterInc('shinobi_llm_tokens_total', result.usage.completion_tokens, { provider: resolvedProvider, model: resolvedModel, type: 'completion', role: this.role });

        const cost = calculateCost(resolvedProvider, resolvedModel, result.usage);
        registry.counterInc('shinobi_llm_cost_usd_total', cost, { provider: resolvedProvider, model: resolvedModel, role: this.role });
      }

      result.output = sanitizeToolCallArguments(result.output);

      const msg = JSON.parse(result.output);
      messages.push(msg);

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        // Task completed, clear tool progress in DB
        this.queue.updateTaskProgress(task.id, { current_tool: null, steps_completed: iterations });
        return msg.content || 'Task completed with no final text output.';
      }

      // Execute tool calls sequentially
      for (const call of msg.tool_calls) {
        if (call.type === 'function') {
          const fnName = call.function.name;
          const fnArgs = call.function.arguments;

          // Update task progress in DB
          this.queue.updateTaskProgress(task.id, { current_tool: fnName, steps_completed: iterations });
          
          let toolResult = '';
          try {
            const tool = tools.find(t => t.name === fnName);
            if (!tool) {
              toolResult = JSON.stringify({ error: `Tool ${fnName} not allowed or not found for this worker.` });
            } else {
              const parsedArgs = JSON.parse(fnArgs);
              const execRes = await tool.execute(parsedArgs);
              toolResult = typeof execRes === 'string' ? execRes : JSON.stringify(execRes);
            }
          } catch (e: any) {
            toolResult = JSON.stringify({ error: e.message });
          }

          const capped = capToolResultJson(toolResult).result;

          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: fnName,
            content: capped
          });
        }
      }
    }

    throw new Error('Max iterations reached without completing the task.');
  }
}
