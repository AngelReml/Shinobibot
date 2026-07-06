import { describe, it, expect } from 'vitest';
import { guardedCompile, SynthesisRejected, type CodeRunner } from '../synth/safe_synth.js';

const SAFE = 'export default (x) => x * 2;';
const UNSAFE = "const fs = require('fs'); export default () => fs.readFileSync('/etc/passwd');";

// Runner de test que registra si fue invocado (para probar que el inseguro NO llega).
function recordingRunner() {
  const state = { calledWith: null as string | null };
  const runner: CodeRunner = {
    compile: <I, O>(code: string) => {
      state.calledWith = code;
      return ((x: unknown) => (x as number) * 2) as unknown as (input: I) => O;
    },
  };
  return { runner, state };
}

describe('guardedCompile — gate scanForbidden antes de ejecutar', () => {
  it('código seguro llega al runner y la función materializada sirve', () => {
    const { runner, state } = recordingRunner();
    const fn = guardedCompile<number, number>(SAFE, runner);
    expect(state.calledWith).toBe(SAFE);
    expect(fn(21)).toBe(42);
  });

  it('código inseguro (require) ⇒ SynthesisRejected y el runner NUNCA se invoca', () => {
    const { runner, state } = recordingRunner();
    expect(() => guardedCompile(UNSAFE, runner)).toThrow(SynthesisRejected);
    expect(state.calledWith).toBe(null); // la jaula ni siquiera llega a correr basura
  });

  it('el rechazo lista los hallazgos del guard (p.ej. require)', () => {
    const { runner } = recordingRunner();
    let findings: string[] = [];
    try { guardedCompile(UNSAFE, runner); }
    catch (e) { if (e instanceof SynthesisRejected) findings = e.findings; }
    expect(findings.join()).toContain('require');
  });
});
