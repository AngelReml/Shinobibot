import { describe, it, expect } from 'vitest';
import { fabricate, type Synthesizer } from '../fabricate.js';
import type { OracleTask } from '../held_out_oracle.js';

// Tarea: doblar. Train y held-out son casos DISTINTOS.
const tasks: OracleTask<number, number>[] = [
  { input: 1, expected: 2 }, { input: 2, expected: 4 }, { input: 3, expected: 6 },
  { input: 10, expected: 20 }, { input: 11, expected: 22 }, { input: 12, expected: 24 },
];

// Sintetizador HONESTO: generaliza (devuelve la transformación correcta).
const honest: Synthesizer<number, number> = { synthesize: () => (x) => x * 2 };
// Sintetizador TRAMPOSO: memoriza los ejemplos de train, falla en lo oculto.
const cheat: Synthesizer<number, number> = {
  synthesize: (train) => { const m = new Map(train.map((t) => [t.input, t.expected])); return (x) => m.get(x) ?? -1; },
};

describe('fabricate', () => {
  it('certifica y DEVUELVE la candidata cuando el sintetizador generaliza', () => {
    const r = fabricate(tasks, honest);
    expect(r.certified).toBe(true);
    expect(r.candidate).toBeDefined();
    expect(r.candidate!(100)).toBe(200); // la candidata sirve fuera de los ejemplos
    expect(r.trainCount + r.heldOutCount).toBe(tasks.length);
    expect(r.heldOutCount).toBeGreaterThan(0);
  });

  it('NO certifica y NO devuelve candidata al tramposo (defensa anti reward-hacking end-to-end)', () => {
    const r = fabricate(tasks, cheat);
    expect(r.certified).toBe(false);
    expect(r.candidate).toBeUndefined();
    expect(r.certifyResult.firstFailure).toBeDefined();
  });

  it('reparte por defecto ~mitad train / mitad held-out', () => {
    const r = fabricate(tasks, honest);
    expect(r.trainCount).toBe(3);
    expect(r.heldOutCount).toBe(3);
  });

  it('trainCount explícito se respeta (mínimo 1)', () => {
    expect(fabricate(tasks, honest, { trainCount: 4 }).trainCount).toBe(4);
    expect(fabricate(tasks, honest, { trainCount: 0 }).trainCount).toBe(1);
  });

  it('si el sintetizador lanza, se propaga (no certifica lo que no se pudo construir)', () => {
    const boom: Synthesizer<number, number> = { synthesize: () => { throw new Error('sin candidata'); } };
    expect(() => fabricate(tasks, boom)).toThrow('sin candidata');
  });
});
