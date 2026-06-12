// src/agents/__tests__/best_of_n.test.ts
//
// Tests del motor E5 (test-time compute). Dos niveles:
//   1) selectBest — PURO, determinista, sin red: la política de orden total.
//   2) runBestOfN — integración con LLM productor y verificador INYECTADOS.
// Sin red. El verificador puntúa según el RESULTADO embebido en su payload.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runBestOfN, selectBest, defaultTemperatures } from '../best_of_n.js';
import type { ScoredCandidate } from '../best_of_n.js';
import type { LLMInvoker } from '../agent_loop.js';

const envelope = (content: string): string => JSON.stringify({ content });

/** Productor que devuelve salidas en orden de llamada (usar con concurrency:1). */
function scriptedProducer(outputs: string[]): LLMInvoker {
  let i = 0;
  return async () => ({ success: true, output: envelope(outputs[Math.min(i++, outputs.length - 1)]), error: '' });
}

/** Verificador que APRUEBA solo si el RESULTADO (embebido en el payload) contiene `good`. */
const verifierByContent = (good: string): LLMInvoker => async (payload) => {
  const seen = JSON.stringify(payload);
  const passed = seen.includes(good);
  return {
    success: true,
    output: envelope(JSON.stringify({ passed, score: passed ? 0.95 : 0.3, issues: passed ? [] : ['no cumple'], rationale: '' })),
    error: '',
  };
};

beforeAll(() => { process.env.SHINOBI_AUDIT_DISABLED = '1'; });
afterAll(() => { delete process.env.SHINOBI_AUDIT_DISABLED; });

// Helper para construir candidatos puntuados de prueba.
function cand(p: Partial<ScoredCandidate> & { index: number }): ScoredCandidate {
  return {
    output: `out${p.index}`, ok: true, verifierPassed: false, score: 0, iterations: 1,
    ...p,
  };
}

describe('selectBest — política de orden total (pura)', () => {
  it('elige el de mayor score entre los aprobados por el verificador', () => {
    const sel = selectBest([
      cand({ index: 0, verifierPassed: true, score: 0.6 }),
      cand({ index: 1, verifierPassed: true, score: 0.9 }),
      cand({ index: 2, verifierPassed: false, score: 0.99 }),
    ]);
    expect(sel.chosenIndex).toBe(1);
    expect(sel.ranking[0]).toBe(1);
  });

  it('la compuerta OBJETIVA domina al score del verificador (gate de código irrevocable)', () => {
    const sel = selectBest([
      cand({ index: 0, verifierPassed: true, score: 0.99, objectivePassed: false }),
      cand({ index: 1, verifierPassed: false, score: 0.30, objectivePassed: true }),
    ]);
    // Aunque 0 tenga score altísimo y verificador OK, 1 pasó los tests reales → gana.
    expect(sel.chosenIndex).toBe(1);
  });

  it('un rollout que NO cerró (ok=false) cae por debajo de uno que cerró', () => {
    const sel = selectBest([
      cand({ index: 0, ok: false, verifierPassed: true, score: 0.99 }),
      cand({ index: 1, ok: true, verifierPassed: false, score: 0.10 }),
    ]);
    expect(sel.chosenIndex).toBe(1);
  });

  it('desempata por menos bucles abortados, luego menos iteraciones, luego índice', () => {
    const sel = selectBest([
      cand({ index: 0, verifierPassed: true, score: 0.8, loopAborts: 1, iterations: 2 }),
      cand({ index: 1, verifierPassed: true, score: 0.8, loopAborts: 0, iterations: 5 }),
      cand({ index: 2, verifierPassed: true, score: 0.8, loopAborts: 0, iterations: 5 }),
    ]);
    // 1 y 2 empatan en todo salvo índice → gana el menor índice (estable/reproducible).
    expect(sel.chosenIndex).toBe(1);
  });

  it('lista vacía → chosenIndex -1, no lanza', () => {
    const sel = selectBest([]);
    expect(sel.chosenIndex).toBe(-1);
  });
});

describe('defaultTemperatures — abanico determinista', () => {
  it('n=1 → una sola temperatura baja', () => {
    expect(defaultTemperatures(1)).toEqual([0.2]);
  });
  it('n=3 → reparte [0.2 .. 1.0]', () => {
    expect(defaultTemperatures(3)).toEqual([0.2, 0.6, 1.0]);
  });
});

describe('runBestOfN — integración (LLM inyectado, sin red)', () => {
  it('genera N candidatos y entrega el que el verificador aprueba', async () => {
    const res = await runBestOfN({
      task: 'resuelve X', systemPrompt: 'eres un agente', tools: [],
      n: 3, concurrency: 1,
      invokeLLM: scriptedProducer(['malo-1', 'BUENO', 'malo-2']),
      verifyInvokeLLM: verifierByContent('BUENO'),
    });
    expect(res.candidates).toHaveLength(3);
    expect(res.output).toContain('BUENO');
    expect(res.selection.chosen.output).toContain('BUENO');
    expect(res.ok).toBe(true);
  });

  it('honesto cuando ninguno cumple: ok=false pero devuelve el mejor relativo', async () => {
    const res = await runBestOfN({
      task: 'imposible', systemPrompt: 'eres un agente', tools: [],
      n: 2, concurrency: 1,
      invokeLLM: scriptedProducer(['x', 'y']),
      verifyInvokeLLM: verifierByContent('NUNCA_APARECE'),
    });
    expect(res.ok).toBe(false);
    expect(res.candidates).toHaveLength(2);
    expect(res.selection.chosenIndex).toBeGreaterThanOrEqual(0);
  });

  it('la compuerta objetiva manda: gana el que pasa tests aunque el verificador prefiera a otro', async () => {
    const res = await runBestOfN({
      task: 'codea', systemPrompt: 'eres un agente', tools: [],
      n: 2, concurrency: 1,
      invokeLLM: scriptedProducer(['BUENO-sin-tests', 'pasa-OBJ']),
      verifyInvokeLLM: verifierByContent('BUENO'),
      objectiveCheck: async (o) => ({ passed: o.includes('OBJ'), issues: o.includes('OBJ') ? [] : ['tests fallan'] }),
    });
    // 'BUENO-sin-tests' enamora al verificador pero NO pasa tests; 'pasa-OBJ' sí → gana.
    expect(res.selection.chosen.output).toContain('OBJ');
  });
});
