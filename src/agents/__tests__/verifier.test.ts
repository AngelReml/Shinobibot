// src/agents/__tests__/verifier.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { extractVerdict, verifyResult } from '../verifier.js';
import type { LLMInvoker } from '../agent_loop.js';

// El LLM devuelve un envelope {content}. El verdict del verificador va en content.
const envelope = (content: string): string => JSON.stringify({ content });

beforeAll(() => { process.env.SHINOBI_AUDIT_DISABLED = '1'; });
afterAll(() => { delete process.env.SHINOBI_AUDIT_DISABLED; });

describe('extractVerdict', () => {
  it('parsea un JSON limpio', () => {
    const v = extractVerdict('{"passed":true,"score":0.9,"issues":[],"rationale":"ok"}');
    expect(v.passed).toBe(true);
    expect(v.score).toBe(0.9);
    expect(v.issues).toEqual([]);
  });

  it('extrae el JSON embebido en texto alrededor', () => {
    const v = extractVerdict('Aquí está mi veredicto:\n{"passed":false,"score":0.2,"issues":["falta X"],"rationale":"meh"} fin');
    expect(v.passed).toBe(false);
    expect(v.issues).toEqual(['falta X']);
  });

  it('fail-safe: texto no parseable → passed=false', () => {
    const v = extractVerdict('no tengo ni idea');
    expect(v.passed).toBe(false);
    expect(v.score).toBe(0);
    expect(v.issues.length).toBeGreaterThan(0);
  });

  it('clampa score fuera de rango y default cuando falta', () => {
    expect(extractVerdict('{"passed":true,"score":5}').score).toBe(1);
    expect(extractVerdict('{"passed":false,"score":-3}').score).toBe(0);
    // score ausente → deriva de passed
    expect(extractVerdict('{"passed":true}').score).toBe(1);
    expect(extractVerdict('{"passed":false}').score).toBe(0);
  });

  it('passed solo true con boolean true estricto', () => {
    expect(extractVerdict('{"passed":"true"}').passed).toBe(false);
    expect(extractVerdict('{"passed":1}').passed).toBe(false);
  });
});

describe('verifyResult', () => {
  it('devuelve el veredicto del revisor', async () => {
    const invoke: LLMInvoker = async () =>
      ({ success: true, output: envelope(JSON.stringify({ passed: true, score: 0.95, issues: [], rationale: 'cumple' })), error: '' });
    const v = await verifyResult({ goal: 'sumar 2+2', result: '4', invokeLLM: invoke });
    expect(v.passed).toBe(true);
    expect(v.rationale).toBe('cumple');
  });

  it('fail-safe si el verificador no puede cerrar (LLM error)', async () => {
    const invoke: LLMInvoker = async () => ({ success: false, output: '', error: 'down' });
    const v = await verifyResult({ goal: 'g', result: 'r', invokeLLM: invoke });
    expect(v.passed).toBe(false);
    expect(v.issues.join(' ')).toMatch(/no pudo emitir veredicto/i);
  });
});
