// src/agents/__tests__/swarm.test.ts
//
// Tests del motor E4 (enjambre). LLM inyectado y dependiente de la tarea para
// resultados deterministas pese a la concurrencia.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runSwarm } from '../swarm.js';
import type { LLMInvoker } from '../agent_loop.js';

const envelope = (content: string): string => JSON.stringify({ content });
const userOf = (payload: any): string =>
  String(payload?.messages?.find((m: any) => m.role === 'user')?.content ?? '');

beforeAll(() => { process.env.SHINOBI_AUDIT_DISABLED = '1'; });
afterAll(() => { delete process.env.SHINOBI_AUDIT_DISABLED; });

describe('runSwarm — enjambre (E4)', () => {
  it('fan-out: preserva el orden y devuelve un resultado por tarea', async () => {
    const echo: LLMInvoker = async (payload) => ({ success: true, output: envelope('hecho: ' + userOf(payload)), error: '' });
    const r = await runSwarm({
      tasks: [{ task: 'A' }, { task: 'B' }, { task: 'C' }],
      invokeLLM: echo,
    });
    expect(r.total).toBe(3);
    expect(r.succeeded).toBe(3);
    expect(r.results.map((x) => x.output)).toEqual(['hecho: A', 'hecho: B', 'hecho: C']);
    expect(r.results.map((x) => x.label)).toEqual(['task-0', 'task-1', 'task-2']);
  });

  it('respeta el cap de concurrencia', async () => {
    let active = 0;
    let maxActive = 0;
    const slow: LLMInvoker = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((res) => setTimeout(res, 10));
      active--;
      return { success: true, output: envelope('ok'), error: '' };
    };
    const r = await runSwarm({
      tasks: Array.from({ length: 5 }, (_, i) => ({ task: `t${i}` })),
      concurrency: 2,
      invokeLLM: slow,
    });
    expect(r.succeeded).toBe(5);
    expect(maxActive).toBe(2); // nunca más de 2 en vuelo a la vez
  });

  it('modo verify: solo cuentan como éxito las tareas que el revisor aprueba', async () => {
    const producer: LLMInvoker = async (payload) => ({ success: true, output: envelope('hecho: ' + userOf(payload)), error: '' });
    const verifier: LLMInvoker = async (payload) => {
      const passed = !/bad/i.test(userOf(payload));
      return {
        success: true,
        output: envelope(JSON.stringify({ passed, score: passed ? 0.9 : 0.2, issues: passed ? [] : ['contiene bad'], rationale: '' })),
        error: '',
      };
    };
    const r = await runSwarm({
      tasks: [{ task: 'good-1' }, { task: 'bad-one' }, { task: 'good-2' }],
      verify: true,
      maxAttempts: 1,
      invokeLLM: producer,
      verifyInvokeLLM: verifier,
    });
    expect(r.succeeded).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.results[1].ok).toBe(false);
    expect(r.results[1].verdict?.passed).toBe(false);
    expect(r.results[0].verdict?.passed).toBe(true);
  });

  it('aísla fallos: una tarea que falla no tumba el resto', async () => {
    const flaky: LLMInvoker = async (payload) => {
      if (/boom/.test(userOf(payload))) return { success: false, output: '', error: 'explota' };
      return { success: true, output: envelope('ok'), error: '' };
    };
    const r = await runSwarm({
      tasks: [{ task: 'fine' }, { task: 'boom' }, { task: 'fine-2' }],
      invokeLLM: flaky,
    });
    expect(r.succeeded).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.results[1].ok).toBe(false);
    expect(r.results[0].ok).toBe(true);
    expect(r.results[2].ok).toBe(true);
  });
});
