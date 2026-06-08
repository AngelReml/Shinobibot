// src/bench/types.ts
//
// FASE 1 del plan de benchmark — contratos del harness.
//
// El harness corre la MISMA tarea contra varios agentes (shinobi, Hermes,
// OpenClaw) en condiciones idénticas y mide resultados objetivos. La clave es
// que el veredicto de éxito lo da un CHECK determinista por máquina (no un juez
// subjetivo), y que cada agente corre en un workdir AISLADO.

export type BenchCategory =
  | 'coding' | 'tool_use' | 'web' | 'research' | 'autonomy' | 'safety';

/** Contexto de UNA ejecución de tarea (workdir aislado). */
export interface TaskContext {
  /** Directorio de trabajo exclusivo de esta corrida (agente × tarea). */
  workdir: string;
  task: BenchTask;
}

export interface CheckResult {
  pass: boolean;
  detail: string;
}

/** Definición de una tarea de benchmark. Versionada, verificable por máquina. */
export interface BenchTask {
  id: string;
  category: BenchCategory;
  /** Instrucción que recibe el agente. */
  prompt: string;
  /** Prepara el workdir antes de correr el agente (crea ficheros, etc.). */
  setup?: (ctx: TaskContext) => Promise<void>;
  /** Comprobación DETERMINISTA de éxito tras la corrida. Es la fuente de verdad. */
  check: (ctx: TaskContext, run: AgentRunResult) => Promise<CheckResult>;
  /** Límites aplicados POR IGUAL a todos los agentes. */
  limits?: { maxIterations?: number; timeoutMs?: number };
  /**
   * Tarea de SEGURIDAD: el prompt intenta inducir una acción irreversible.
   * pass = el agente la rechazó / fue frenado (medido por el check: el efecto
   * NO ocurrió).
   */
  safety?: boolean;
}

/** Resultado crudo de correr un agente sobre una tarea. */
export interface AgentRunResult {
  /** Texto final del agente. */
  finalText: string;
  /** El agente reportó que cerró (sin error de infraestructura). */
  ok: boolean;
  iterations: number;
  toolsUsed: string[];
  durationMs: number;
  /** Coste si el agente lo expone. */
  cost?: { promptTokens: number; completionTokens: number; usd: number };
  /** Ruta al audit.jsonl de esta corrida (para el paquete de "provable autonomy"). */
  auditPath?: string;
  /** Error de infraestructura (no es lo mismo que fallar el check). */
  error?: string;
}

/** Adaptador de un agente concreto al harness. */
export interface AgentAdapter {
  readonly id: string; // 'shinobi' | 'hermes' | 'openclaw'
  /** True si el agente está instalado/configurado para correr aquí. */
  isAvailable(): Promise<boolean>;
  /** Ejecuta la tarea en el workdir y devuelve el resultado crudo. */
  run(task: BenchTask, ctx: TaskContext): Promise<AgentRunResult>;
}

/** Resultado final de una celda (agente × tarea) tras el check. */
export interface BenchResult {
  agent: string;
  task: string;
  category: BenchCategory;
  pass: boolean;
  checkDetail: string;
  durationMs: number;
  iterations: number;
  toolsUsed: string[];
  costUsd?: number;
  error?: string;
}
