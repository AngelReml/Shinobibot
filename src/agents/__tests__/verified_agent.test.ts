// src/agents/__tests__/verified_agent.test.ts
//
// Tests del bucle de corrección cerrado (motor E1). Productor y verificador
// llevan invokers de LLM separados e inyectados (deterministas, sin red).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runVerifiedAgent } from '../verified_agent.js';
import type { LLMInvoker } from '../agent_loop.js';

const envelope = (content: string): string => JSON.stringify({ content });
const verdict = (passed: boolean, issues: string[] = [], score = passed ? 0.9 : 0.3): string =>
  envelope(JSON.stringify({ passed, score, issues, rationale: passed ? 'ok' : 'defectos' }));

/** Invoker secuencial que cuenta sus llamadas (repite la última respuesta). */
function seq(outputs: string[]) {
  let i = 0;
  const fn: LLMInvoker = async () => {
    const o = outputs[Math.min(i, outputs.length - 1)];
    i++;
    return { success: true, output: o, error: '' };
  };
  return Object.assign(fn, { calls: () => i });
}

beforeAll(() => { process.env.SHINOBI_AUDIT_DISABLED = '1'; });
afterAll(() => { delete process.env.SHINOBI_AUDIT_DISABLED; });

describe('runVerifiedAgent — bucle de corrección cerrado', () => {
  it('aprueba a la primera cuando el verificador pasa', async () => {
    const producer = seq([envelope('resultado bueno')]);
    const verifier = seq([verdict(true)]);
    const r = await runVerifiedAgent({
      task: 'haz X', systemPrompt: 's', tools: [],
      invokeLLM: producer, verifyInvokeLLM: verifier,
    });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(1);
    expect(r.output).toBe('resultado bueno');
    expect(producer.calls()).toBe(1);
  });

  it('reintenta con feedback y aprueba al segundo intento', async () => {
    const producer = seq([envelope('borrador 1'), envelope('borrador 2 corregido')]);
    const verifier = seq([verdict(false, ['falta una sección']), verdict(true)]);
    const r = await runVerifiedAgent({
      task: 'redacta', systemPrompt: 's', tools: [], maxAttempts: 3,
      invokeLLM: producer, verifyInvokeLLM: verifier,
    });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
    expect(r.output).toBe('borrador 2 corregido');
    expect(producer.calls()).toBe(2); // el productor corrió dos veces
    expect(r.history.length).toBe(2);
    expect(r.history[0].verdict.passed).toBe(false);
  });

  it('agota intentos y reporta fallo con honestidad (no falso éxito)', async () => {
    const producer = seq([envelope('intento')]);
    const verifier = seq([verdict(false, ['mal'])]);
    const r = await runVerifiedAgent({
      task: 'imposible', systemPrompt: 's', tools: [], maxAttempts: 2,
      invokeLLM: producer, verifyInvokeLLM: verifier,
    });
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(2);
    expect(r.history.length).toBe(2);
    expect(r.verdict.passed).toBe(false);
  });

  it('si el productor no cierra (LLM error), cuenta como no-pasa y reintenta', async () => {
    let n = 0;
    const producer: LLMInvoker = async () => { n++; return { success: false, output: '', error: 'boom' }; };
    const verifier = seq([verdict(true)]); // no debería ni llamarse
    const r = await runVerifiedAgent({
      task: 't', systemPrompt: 's', tools: [], maxAttempts: 2,
      invokeLLM: producer, verifyInvokeLLM: verifier,
    });
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(2);
    expect(n).toBe(2); // reintentó el productor
    expect(verifier.calls()).toBe(0); // el verificador nunca se invocó
    expect(r.verdict.issues.join(' ')).toMatch(/no cerró/i);
  });
});
