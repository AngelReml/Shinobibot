/**
 * kagemusha/adapters.ts — ⚠ ENGANCHE layer. Thin, typed wrappers over the REAL
 * Shinobi subsystems, verified against their actual signatures. The rest of
 * Kagemusha depends on THESE stable shapes, never on a guessed signature. Reuse,
 * never duplicate (dossier §3).
 *
 *   runAgentLoop  (src/agents/agent_loop.ts:148)     — run one mission task
 *   runSwarm      (src/agents/swarm.ts:99)            — parallelize N tasks
 *   invokeLLM     (src/providers/provider_router.ts) — LLM + failover, per-call model
 *   EmbeddingProvider (src/memory/embedding_provider) — embeddings
 *   runDiagnostics(src/lsp/diagnostics.ts)           — static analysis
 *   getTool('run_command') (src/tools/run_command.ts) — subprocess (yt-dlp)
 */

import { runAgentLoop, type AgentLoopResult } from '../agents/agent_loop.js';
import { runSwarm } from '../agents/swarm.js';
import { invokeLLM } from '../providers/provider_router.js';
import { EmbeddingProvider } from '../memory/embedding_provider.js';
import { getTool } from '../tools/tool_registry.js';

export interface KageMessage { role: 'system' | 'user' | 'assistant'; content: string; }

/** A resilient LLM call with per-call model selection (dossier §12.3). */
export async function kageLLM(messages: KageMessage[], model?: string): Promise<{ ok: boolean; text: string; error?: string }> {
  const res = await invokeLLM({ messages, model: model || undefined } as any);
  return { ok: !!res.success, text: String(res.output ?? ''), error: res.error };
}

/** Embeddings (reuses the local/hash/openai backend; offline-safe fallback). */
export async function kageEmbed(text: string): Promise<number[]> {
  return EmbeddingProvider.embed(text);
}
export async function kageEmbedBatch(texts: string[]): Promise<number[][]> {
  return EmbeddingProvider.embedBatch(texts);
}

/** Cosine similarity over embedding vectors (reuses the provider's metric). */
export function cosine(a: number[], b: number[]): number {
  return EmbeddingProvider.cosineSimilarity(a, b);
}

/** Run one autonomous task on the existing agent loop (NOT a new loop). */
export async function kageRunTask(opts: { task: string; systemPrompt?: string; tools?: string[]; model?: string; maxIterations?: number; label?: string }): Promise<AgentLoopResult> {
  return runAgentLoop({
    task: opts.task,
    systemPrompt: opts.systemPrompt ?? 'You are a focused Kagemusha sub-agent.',
    tools: opts.tools ?? [],
    model: opts.model,
    maxIterations: opts.maxIterations,
    label: opts.label,
  });
}

/** Parallelize N tasks on the existing swarm (no worktree). */
export async function kageSwarm(tasks: Array<{ task: string; label?: string; tools?: string[] }>, opts: { systemPrompt?: string; model?: string; concurrency?: number } = {}) {
  return runSwarm({ tasks, systemPrompt: opts.systemPrompt, model: opts.model, concurrency: opts.concurrency });
}

/** Run a subprocess through the existing run_command tool (reuses its sandbox). */
export async function kageSubprocess(command: string, opts: { cwd?: string; timeout?: number } = {}): Promise<{ success: boolean; output: string; error?: string }> {
  const tool = getTool('run_command');
  if (!tool) return { success: false, output: '', error: 'run_command tool not registered' };
  const r = await tool.execute({ command, cwd: opts.cwd, timeout: opts.timeout });
  return { success: !!r.success, output: String(r.output ?? ''), error: r.error };
}
