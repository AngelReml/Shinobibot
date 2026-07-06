import { describe, it, expect } from 'vitest';
import { splitTasks, certifyAgainstHeldOut, structuralEqual, type OracleTask } from '../held_out_oracle.js';

// Tarea de ejemplo: doblar un número. Los casos de train y held-out son DISTINTOS.
const tasks: OracleTask<number, number>[] = [
  { input: 1, expected: 2 }, { input: 2, expected: 4 }, { input: 3, expected: 6 },
  { input: 10, expected: 20 }, { input: 11, expected: 22 }, { input: 12, expected: 24 },
];

describe('splitTasks', () => {
  it('reparte determinista: primeros N a train, resto a held-out', () => {
    const { train, heldOut } = splitTasks(tasks, 3);
    expect(train.map((t) => t.input)).toEqual([1, 2, 3]);
    expect(heldOut.map((t) => t.input)).toEqual([10, 11, 12]);
  });
  it('acota trainCount al rango [0, len]', () => {
    expect(splitTasks(tasks, 99).heldOut).toHaveLength(0);
    expect(splitTasks(tasks, -5).train).toHaveLength(0);
  });
});

describe('certifyAgainstHeldOut', () => {
  const { train, heldOut } = splitTasks(tasks, 3);

  it('certifica un candidato CORRECTO (pasa todos los ocultos)', () => {
    const r = certifyAgainstHeldOut((x: number) => x * 2, heldOut);
    expect(r.certified).toBe(true);
    expect(r.heldOutPassed).toBe(3);
    expect(r.heldOutTotal).toBe(3);
  });

  it('NO certifica al tramposo: memoriza train pero falla en held-out (defensa anti reward-hacking)', () => {
    const trainMap = new Map(train.map((t) => [t.input, t.expected]));
    const cheat = (x: number) => trainMap.get(x) ?? -1; // acierta train, -1 en lo oculto
    const r = certifyAgainstHeldOut(cheat, heldOut);
    expect(r.certified).toBe(false);
    expect(r.firstFailure).toBeDefined();
    expect(r.firstFailure!.got).toBe(-1);
  });

  it('NO certifica si el candidato LANZA (código roto)', () => {
    const boom = (_x: number): number => { throw new Error('kaboom'); };
    const r = certifyAgainstHeldOut(boom, heldOut);
    expect(r.certified).toBe(false);
    expect(r.threw).toBeDefined();
    expect(r.threw!.error).toContain('kaboom');
  });

  it('fail-closed: sin casos ocultos NO se certifica', () => {
    const r = certifyAgainstHeldOut((x: number) => x * 2, []);
    expect(r.certified).toBe(false);
    expect(r.heldOutTotal).toBe(0);
  });

  it('una sola salida distinta basta para NO certificar', () => {
    const almost = (x: number) => (x === 11 ? 999 : x * 2);
    const r = certifyAgainstHeldOut(almost, heldOut);
    expect(r.certified).toBe(false);
    expect(r.firstFailure!.input).toBe(11);
  });
});

describe('structuralEqual', () => {
  it('compara por estructura, no por referencia', () => {
    expect(structuralEqual({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(structuralEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
});
