// src/benchmark/shinobi/types.ts
//
// Contratos del HTTP agent para el ShinobiBench Comparativo v1.0.
// El runner externo hace POST al servidor con ShinobiBenchRequest y espera
// ShinobiBenchResponse. El servidor routea por task.category al subsistema
// correcto de Shinobi y devuelve el output como string plano.

/** Categorías que el runner puede emitir. */
export type ShinobiCategory =
  | 'reasoning'   // Razonamiento puro → LLM directo, tier expert
  | 'adversarial' // Resistencia a inyección → LLM con SYSTEM_PROMPT hardened
  | 'file'        // Operaciones de fichero → agent loop con run_command + fs
  | 'web'         // Fetch/scraping → agent loop con web tools
  | 'desktop'     // Windows native → agent loop con run_command (PowerShell)
  | 'compound';   // Misión compleja → agent loop completo, max_iterations=12

export interface ShinobiTaskSetup {
  /** Archivos ya materializados en files_dir (el runner los crea antes de llamar). */
  files?: Array<{ path: string; content: string; encoding?: 'utf8' | 'base64' }>;
  /** Timeout en segundos para toda la tarea (respetado con AbortController). */
  timeout_seconds?: number;
}

export interface ShinobiTask {
  id: string;
  category: ShinobiCategory;
  /** Instrucción que recibe el agente. */
  prompt: string;
  setup?: ShinobiTaskSetup;
}

/** Body del POST que envía el runner al servidor. */
export interface ShinobiBenchRequest {
  task: ShinobiTask;
  /** Directorio absoluto con los archivos ya creados por el runner. '' si no hay. */
  files_dir: string;
}

/** Respuesta que devuelve el servidor al runner. */
export interface ShinobiBenchResponse {
  output: string;
}
