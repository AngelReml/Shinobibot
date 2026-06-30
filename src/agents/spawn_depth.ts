// src/agents/spawn_depth.ts
//
// Rastreador de profundidad de spawn por contexto async (AsyncLocalStorage).
//
// Problema que resuelve: process.env.SHINOBI_SPAWN_DEPTH es una variable global
// compartida. Cuando run_swarm ejecuta N tareas en paralelo via Promise.all, todas
// leen y mutan el mismo env var → la profundidad se acumula entre ramas hermanas
// produciendo DEPTH_EXCEEDED falsos (profundidad 6/3 cuando ningún nodo supera 2).
//
// Con AsyncLocalStorage cada rama async hereda una COPIA del valor del padre al
// momento del fork; las mutaciones de una rama NO afectan a las hermanas.

import { AsyncLocalStorage } from 'async_hooks';

const _store = new AsyncLocalStorage<number>();

/** Lee la profundidad del contexto async actual. Cae en env solo en el contexto raíz. */
export function getSpawnDepth(): number {
  const local = _store.getStore();
  if (local !== undefined) return local;
  return Number(process.env.SHINOBI_SPAWN_DEPTH || '0') || 0;
}

/** Lee el límite máximo de profundidad (env SHINOBI_MAX_SPAWN_DEPTH, default 3). */
export function getMaxSpawnDepth(): number {
  return Number(process.env.SHINOBI_MAX_SPAWN_DEPTH || '3') || 3;
}

/**
 * Ejecuta `fn` dentro de un contexto async con la profundidad dada.
 * Las ramas paralelas (Promise.all) que arrancan desde dentro de `fn`
 * heredan cada una su propia copia del valor — no interfieren entre sí.
 */
export function runWithSpawnDepth<T>(depth: number, fn: () => T): T {
  return _store.run(depth, fn);
}
