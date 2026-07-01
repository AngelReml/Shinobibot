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
 *
 * F2.11 (auditoría 2026-07-01): la corrección dependía enteramente de que
 * TODO caller de `ShinobiOrchestrator.process()` recordara envolverlo en
 * `runExclusive` — un caller nuevo que lo olvidara introducía corrupción de
 * estado real entre sesiones concurrentes, sin ningún error visible hasta
 * que dos misiones chocaban. `process()` ahora adquiere el mutex ÉL MISMO
 * internamente (ver orchestrator.ts), así que es imposible ejecutar el loop
 * sin pasar por aquí — el caller deja de ser responsable. Eso significa que
 * los 4 call-sites existentes que YA envolvían `process()` en
 * `runExclusive` (web/server.ts, gateway/telegram_channel.ts,
 * gateway/http_channel.ts, channels/channels_wiring.ts) ahora anidan una
 * llamada a `runExclusive` DENTRO de otra — sin manejo especial, esto
 * deadlockearía: la llamada externa espera a que su propio `fn` termine,
 * pero ese `fn` está esperando a la llamada interna, que a su vez espera a
 * que la cadena (bloqueada por la externa) avance. `AsyncLocalStorage`
 * (mismo patrón que el repo ya usa con éxito para el aislamiento de
 * sub-agentes) marca el contexto async de una ejecución en curso: una
 * llamada anidada DENTRO de esa misma cadena de async/await se detecta y
 * corre inline (sin re-encolar); una llamada CONCURRENTE pero no anidada
 * (otro caller, sin la marca) se serializa normalmente. Así los call-sites
 * externos no necesitan tocarse — siguen siendo redundantes-pero-seguros,
 * no se retiran para minimizar el diff de un fix de seguridad.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

let _chain: Promise<unknown> = Promise.resolve();
const _als = new AsyncLocalStorage<true>();

/** Ejecuta `fn` en exclusión mutua con las demás llamadas a runExclusive. */
export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  // Reentrancia segura: si esta llamada se originó DENTRO de una ejecución
  // runExclusive ya en curso (mismo hilo async), correr inline evita el
  // deadlock descrito arriba. Una llamada concurrente pero no anidada no
  // lleva la marca de ALS y se serializa como siempre.
  if (_als.getStore()) return fn();
  const run = _chain.then(() => _als.run(true, fn));
  // La cola avanza pase lo que pase con `run` (éxito o error).
  _chain = run.then(() => undefined, () => undefined);
  return run;
}
