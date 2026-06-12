// src/runtime/__tests__/escalation.test.ts
//
// Tests del motor E8 (escalada relentless). Puro e inyectable, sin red ni esperas.

import { describe, it, expect } from 'vitest';
import { decideEscalation, backoffMs, taskWeight, runRelentless } from '../escalation.js';

const noSleep = () => Promise.resolve();

describe('decideEscalation — imparable pero acotado', () => {
  it('fatal → give_up (único freno duro)', () => {
    expect(decideEscalation({ attempt: 1, maxAttempts: 5, fatal: true })).toBe('give_up');
  });
  it('tarea ligera con presupuesto agotado → give_up honesto', () => {
    expect(decideEscalation({ attempt: 5, maxAttempts: 5, taskWeight: 0.1 })).toBe('give_up');
  });
  it('tarea PESADA pasada la mitad → acude al ejército (swarm)', () => {
    expect(decideEscalation({ attempt: 3, maxAttempts: 5, taskWeight: 0.8 })).toBe('swarm');
  });
  it('tarea pesada ya escalada no re-escala: retry hasta agotar', () => {
    expect(decideEscalation({ attempt: 4, maxAttempts: 6, taskWeight: 0.8, swarmTried: true })).toBe('retry');
  });
  it('rate_limit → failover; transitorio → retry', () => {
    expect(decideEscalation({ attempt: 1, maxAttempts: 5, failureMode: 'rate_limit' })).toBe('failover');
    expect(decideEscalation({ attempt: 1, maxAttempts: 5, failureMode: 'transient' })).toBe('retry');
  });
});

describe('backoffMs / taskWeight', () => {
  it('backoff exponencial con tope', () => {
    expect(backoffMs(1, 200)).toBe(200);
    expect(backoffMs(3, 200)).toBe(800);
    expect(backoffMs(20, 200, 8000)).toBe(8000);
  });
  it('taskWeight: pocas señales → ligera; muchas → pesada', () => {
    expect(taskWeight({ files: 2, loc: 50 })).toBeLessThan(0.6);
    expect(taskWeight({ repos: 5 })).toBe(1);
    expect(taskWeight({ subtasks: 5 })).toBe(1);
  });
});

describe('runRelentless — alcanza el objetivo o escala, nunca finge éxito', () => {
  it('flaky (falla 2, luego ok) → éxito en el intento 3', async () => {
    let n = 0;
    const r = await runRelentless({
      work: async () => { n++; if (n < 3) throw new Error('red'); return 'ok'; },
      classify: () => 'transient', maxAttempts: 5, sleep: noSleep,
    });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(3);
    expect(r.escalatedToSwarm).toBe(false);
  });

  it('tarea ligera que siempre falla → ok:false SIN llamar al enjambre', async () => {
    const r = await runRelentless({
      work: async () => { throw new Error('x'); },
      classify: () => 'unknown', maxAttempts: 4, taskWeight: 0.1, sleep: noSleep,
    });
    expect(r.ok).toBe(false);
    expect(r.escalatedToSwarm).toBe(false);
  });

  it('tarea PESADA → acude al ejército y lo resuelve', async () => {
    let swarmCalls = 0;
    const r = await runRelentless({
      work: async () => { throw new Error('pesado'); },
      onSwarm: async () => { swarmCalls++; return 'EJERCITO'; },
      classify: () => 'unknown', maxAttempts: 5, taskWeight: 0.9, sleep: noSleep,
    });
    expect(r.ok).toBe(true);
    expect(r.escalatedToSwarm).toBe(true);
    expect(r.value).toBe('EJERCITO');
    expect(swarmCalls).toBeGreaterThan(0);
  });

  it('error fatal → se detiene en seco en el primer intento', async () => {
    const r = await runRelentless({
      work: async () => { throw new Error('fatal'); },
      isFatal: () => true, maxAttempts: 5, sleep: noSleep,
    });
    expect(r.ok).toBe(false);
    expect(r.gaveUpReason).toBe('fatal');
    expect(r.attempts).toBe(1);
  });

  it('el loop-detector corta el bucle estéril', async () => {
    let calls = 0;
    const r = await runRelentless({
      work: async () => { calls++; throw new Error('bucle'); },
      onAbortSignal: () => true, maxAttempts: 9, sleep: noSleep,
    });
    expect(r.gaveUpReason).toBe('loop_detector');
    expect(calls).toBe(1);
  });
});
