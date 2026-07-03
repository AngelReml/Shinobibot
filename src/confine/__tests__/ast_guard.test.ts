// P3 — tests del guard por AST. Mutación: scanForbidden que siempre devuelve safe →
// todos los casos de detección se ponen rojos. Regla #2, evidencia en DECISIONES.
import { describe, it, expect } from 'vitest';
import { scanForbidden } from '../ast_guard.js';

describe('P3 — ast_guard.scanForbidden', () => {
  it('código limpio ⇒ safe', () => {
    expect(scanForbidden('const x = 1 + 2; export const y = x;').safe).toBe(true);
    expect(scanForbidden('const o = {}; o.foo = 1; export {};').safe).toBe(true);
  });
  it('detecta identificadores prohibidos (process/eval/require)', () => {
    expect(scanForbidden('process.env.HOME').safe).toBe(false);
    expect(scanForbidden("eval('2+2')").safe).toBe(false);
    expect(scanForbidden("require('fs')").safe).toBe(false);
  });
  it('detecta OFUSCACIÓN que la regex no ve', () => {
    expect(scanForbidden("globalThis['pro'+'cess'].exit(1)").safe).toBe(false);
    expect(scanForbidden("Reflect.get(globalThis,'process')").safe).toBe(false);
  });
  it('detecta import() dinámico', () => {
    expect(scanForbidden("const m='fs'; import(m)").safe).toBe(false);
  });
});
