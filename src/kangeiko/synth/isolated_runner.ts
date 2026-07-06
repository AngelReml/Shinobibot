// P5 — runner REAL de código sintetizado en la jaula isolated-vm.
//
// ⚠ NO VERIFICADO EN ESTE ENTORNO (pending Windows). isolated-vm es un módulo NATIVO;
// en el sandbox Linux de desarrollo no se ejecuta (el binario instalado es win32). Este
// fichero está cableado detrás de su interfaz (CodeRunner) y del flag del sintetizador
// (default OFF): NADA lo instancia por defecto. Verificación pendiente en el Windows
// nativo del usuario: `npm run test` con el flag on, y la prueba de confinamiento —un
// transform que intente un efecto (fetch/fs) debe morir SIN efecto—. Reusa el MISMO
// mecanismo ivm que hot_plug_registry.ts (memoryLimit + timeout, isolate FRESCO por
// llamada disposed en finally, marshaling por JSON); no integra ivm por segunda vez.

import ivm from 'isolated-vm';
import { transformEsmToV8Script } from '../../plugins/hot_plug_registry.js';
import type { CodeRunner } from './safe_synth.js';

const MEM_LIMIT_MB = 64;
const COMPILE_TIMEOUT_MS = 500;
const RUN_TIMEOUT_MS = Number(process.env.SHINOBI_SYNTH_RUN_TIMEOUT_MS) || 1000;

/**
 * CodeRunner real: compila el código sintetizado (`export default (input)=>output`) y
 * devuelve una función SÍNCRONA `(input)=>output`. Cada invocación crea un isolate
 * FRESCO (mem+timeout), corre la transformación con el input marshalado como literal
 * JSON, devuelve el resultado por JSON, y DISPONE el isolate en finally (sin fugas). El
 * código ya pasó el gate scanForbidden antes de llegar aquí (ver safe_synth.ts).
 */
export class IsolatedVmRunner implements CodeRunner {
  compile<I, O>(code: string): (input: I) => O {
    const transformed = transformEsmToV8Script(code);
    return (input: I): O => {
      const isolate = new ivm.Isolate({ memoryLimit: MEM_LIMIT_MB });
      try {
        const context = isolate.createContextSync();
        context.evalSync(
          'globalThis.console={log(){},warn(){},error(){}};globalThis.module={exports:{}};',
        );
        isolate.compileScriptSync(transformed).runSync(context, { timeout: COMPILE_TIMEOUT_MS });
        const src = `JSON.stringify((module.exports.default||module.exports)(${JSON.stringify(input)}))`;
        const out = isolate.compileScriptSync(src).runSync(context, { timeout: RUN_TIMEOUT_MS }) as string;
        if (typeof out !== 'string') throw new Error('el código sintetizado no produjo un resultado serializable');
        return JSON.parse(out) as O;
      } finally {
        isolate.dispose();
      }
    };
  }
}
