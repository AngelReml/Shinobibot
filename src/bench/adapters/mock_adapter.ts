// src/bench/adapters/mock_adapter.ts
//
// Adaptador determinista para testear el harness sin LLM ni agentes externos.

import type { AgentAdapter, AgentRunResult, BenchTask, TaskContext } from '../types.js';

export type MockBehavior = (task: BenchTask, ctx: TaskContext) => Promise<AgentRunResult> | AgentRunResult;

export class MockAdapter implements AgentAdapter {
  constructor(
    readonly id: string,
    private readonly behavior: MockBehavior,
    private readonly available = true,
  ) {}

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async run(task: BenchTask, ctx: TaskContext): Promise<AgentRunResult> {
    return await this.behavior(task, ctx);
  }
}
