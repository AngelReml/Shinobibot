// src/agents/exec_context.ts
//
// CONTEXTO DE EJECUCIÓN por agente (base de Team — paralelismo real de
// mutaciones).
//
// El problema raíz: el cwd de shinobi era GLOBAL al proceso (process.cwd() +
// WORKSPACE_ROOT), así que dos agentes que escriben ficheros en paralelo se
// pisaban. La solución correcta NO es process.chdir (global, condición de
// carrera) sino AsyncLocalStorage: un contexto {cwd, workspaceRoot} que viaja
// por la cadena async de CADA agente lógico, aislado entre agentes concurrentes.
//
// Compatibilidad: sin contexto activo, contextCwd()===process.cwd() y
// contextWorkspaceRoot()===(WORKSPACE_ROOT||cwd), y resolveInContext(p) ===
// path.resolve(p). Es decir, el comportamiento por defecto es IDÉNTICO al
// anterior — el contexto solo cambia algo DENTRO de runInContext().

import { AsyncLocalStorage } from 'async_hooks';
import * as path from 'path';

export interface ExecContext {
  /** Directorio de trabajo lógico de este agente. */
  cwd: string;
  /** Raíz del workspace (frontera de validatePath) para este agente. */
  workspaceRoot: string;
}

const als = new AsyncLocalStorage<ExecContext>();

/** Ejecuta `fn` con un contexto de ejecución scoped (cwd + workspaceRoot). */
export function runInContext<T>(ctx: ExecContext, fn: () => Promise<T>): Promise<T> {
  return als.run({ cwd: path.resolve(ctx.cwd), workspaceRoot: path.resolve(ctx.workspaceRoot) }, fn);
}

/** Contexto actual, o undefined si no hay ninguno activo. */
export function currentContext(): ExecContext | undefined {
  return als.getStore();
}

/** cwd efectivo: el del contexto, o process.cwd() si no hay contexto. */
export function contextCwd(): string {
  return currentContext()?.cwd ?? process.cwd();
}

/** Raíz del workspace efectiva: la del contexto, o WORKSPACE_ROOT||cwd. */
export function contextWorkspaceRoot(): string {
  return currentContext()?.workspaceRoot ?? process.env.WORKSPACE_ROOT ?? process.cwd();
}

/**
 * Resuelve un path relativo contra el cwd del contexto (absoluto se respeta).
 * Sin contexto, equivale a path.resolve(p) — mismo comportamiento de siempre.
 */
export function resolveInContext(p: string): string {
  if (!p) return path.resolve(contextCwd());
  return path.isAbsolute(p) ? path.resolve(p) : path.resolve(contextCwd(), p);
}
