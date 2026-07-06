import { describe, it, expect } from 'vitest';
import { fabricateAsync, type AsyncSynthesizer } from '../fabricate_async.js';
import type { OracleTask } from '../held_out_oracle.js';

const tasks: OracleTask<number, number>[] = [
  { input: 1, expected: 2 }, { input: 2, expected: 4 }, { input: 3, expected: 6 },
  { input: 10, expected: 20 }, { input: 11, expected: 22 }, { input: 12, expected: 24 },
];

// Async honesto: generaliza. Async tramposo: memoriza train, falla en lo oculto.
const honest: AsyncSynthesizer<number, number> = { synthesize: async () => (x) => x * 2 };
const cheat: AsyncSynthesizer<number, number> = {
  synthesize: async (train) => { const m = new Map(train.map((t) => [t.input, t.expected])); return (x) => m.get(x) ?? -1; },
};

describe('fabricateAsync', () => {
  it('certifica y devuelve candidata cuando la síntesis generaliza', async () => {
    const r = await fabricateAsync(tasks, honest);
    expect(r.certified).toBe(true);
    expect(r.candidate).toBeDefined();
    expect(r.candidate!(100)).toBe(200);
    expect(r.heldOutCount).toBeGreaterThan(0);
  });

  it('NO certifica ni devuelve candidata al tramposo (anti reward-hacking, camino async)', async () => {
    const r = await fabricateAsync(tasks, cheat);
    expect(r.certified).toBe(false);
    expect(r.candidate).toBeUndefined();
    expect(r.certifyResult.firstFailure).toBeDefined();
  });

  it('propaga el rechazo de la síntesis (código inseguro / LLM caído) sin certificar', async () => {
    const rejecting: AsyncSynthesizer<number, number> = { synthesize: async () => { throw new Error('rechazado'); } };
    await expect(fabricateAsync(tasks, rejecting)).rejects.toThrow('rechazado');
  });
});
