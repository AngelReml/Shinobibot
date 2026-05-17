/**
 * Mutex global del orchestrator.
 *
 * `ShinobiOrchestrator` mantiene estado estático (modelo activo, contadores,
 * buffers de loop-detection). Procesar dos misiones en paralelo sobre ese
 * estado lo corrompe. El web server ya serializa sus peticiones con una
 * cola `busy`; este mutex expone la misma garantía como primitiva
 * reutilizable para los demás entry points (canales, A2A, gateway).
 *
 * `runExclusive(fn)` encadena `fn` tras lo que haya en curso y devuelve su
 * resultado. Un fallo de una tarea no rompe la cadena para las siguientes.
 */

let _chain: Promise<unknown> = Promise.resolve();

/** Ejecuta `fn` en exclusión mutua con las demás llamadas a runExclusive. */
export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = _chain.then(() => fn());
  // La cola avanza pase lo que pase con `run` (éxito o error).
  _chain = run.then(() => undefined, () => undefined);
  return run;
}
