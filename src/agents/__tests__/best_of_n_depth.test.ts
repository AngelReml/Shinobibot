// src/agents/__tests__/best_of_n_depth.test.ts
// Tests de spawn_depth para el motor best_of_n (E5).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runBestOfN } from '../best_of_n.js';
import { getSpawnDepth, runWithSpawnDepth } from '../spawn_depth.js';
import type { LLMInvoker } from '../agent_loop.js';

const envelope = (c: string) => JSON.stringify({ content: c });
const mockOk: LLMInvoker = async () => ({ success: true, output: envelope('resultado'), error: '' });
const mockVerifier: LLMInvoker = async () => ({
  success: true,
  output: envelope(JSON.stringify({ passed: true, score: 0.9, issues: [], rationale: '' })),
  error: '',
});

beforeAll(() => { process.env.SHINOBI_AUDIT_DISABLED = '1'; });
afterAll(() => { delete process.env.SHINOBI_AUDIT_DISABLED; });

describe('runBestOfN — spawn_depth', () => {
  it('N candidatos en paralelo sin exceder profundidad (happy path)', async () => {
    const result = await runBestOfN({
      task: 'test task',
      systemPrompt: 'eres un agente',
      tools: [],
      n: 3,
      concurrency: 3,
      invokeLLM: mockOk,
      verifyInvokeLLM: mockVerifier,
    });
    expect(result.attempts).toBe(3);
    expect(getSpawnDepth()).toBe(0); // restaurado al salir del contexto
  });

  it('lanza si profundidad actual + 1 >= maxDepth', async () => {
    process.env.SHINOBI_MAX_SPAWN_DEPTH = '2';
    try {
      await expect(
        runWithSpawnDepth(1, () =>
          runBestOfN({
            task: 'test task',
            systemPrompt: 'eres un agente',
            tools: [],
            n: 3,
            invokeLLM: mockOk,
            verifyInvokeLLM: mockVerifier,
          })
        )
      ).rejects.toThrow(/profundidad máxima/i);
    } finally {
      delete process.env.SHINOBI_MAX_SPAWN_DEPTH;
    }
  });

  it('candidatos hermanos ven la misma profundidad (no acumulan entre sí)', async () => {
    const depths: number[] = [];
    const captureDepth: LLMInvoker = async () => {
      depths.push(getSpawnDepth());
      return { success: true, output: envelope('ok'), error: '' };
    };
    await runWithSpawnDepth(1, () =>
      runBestOfN({
        task: 'test',
        systemPrompt: 'agente',
        tools: [],
        n: 3,
        concurrency: 3,
        invokeLLM: captureDepth,
        verifyInvokeLLM: mockVerifier,
      })
    );
    // Todos ven profundidad 2 (padre=1, +1 por boundedPool); no valores acumulados.
    expect(depths.length).toBeGreaterThan(0);
    expect(depths.every((d) => d === 2)).toBe(true);
  });
});
