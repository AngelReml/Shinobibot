/**
 * Run Backend — contrato común para los backends de ejecución de
 * comandos del Sprint 1.4.
 *
 * Cada backend ejecuta el mismo concepto ("corre este comando, devuelve
 * stdout/stderr/exitCode") en un sustrato distinto:
 *
 *   - `local`   : `child_process.exec` en el host (default histórico)
 *   - `docker`  : container Docker ephemeral (ya implementado en
 *                 src/tools/_docker_backend.ts)
 *   - `ssh`     : VPS remoto vía SSH (opcional, requiere SSH_HOST,
 *                 SSH_USER, SSH_KEY_PATH/SSH_PASS, SSH_PORT)
 *   - `modal`   : Modal serverless containers (requiere MODAL_TOKEN_ID/SECRET)
 *   - `daytona` : Daytona dev environments (requiere DAYTONA_API_KEY)
 *   - `e2b`     : E2B sandboxes (requiere E2B_API_KEY)
 *   - `mock`    : determinista, para tests, devuelve outputs scripted
 *
 * La política `SHINOBI_RUN_BACKEND` env selecciona uno (default `local`).
 * Los que requieren credenciales se mantienen registrados pero
 * `isConfigured() === false` cuando faltan; el registry no los elige a
 * menos que el usuario los pida explícito y haya credenciales.
 *
 * Diferenciador vs Hermes (7 backends, varios experimentales) y OpenClaw
 * (Docker + PTY local): Shinobi expone una **fachada uniforme** y deja al
 * operador decidir qué backend activar.
 */

export type BackendId = 'local' | 'docker' | 'ssh' | 'modal' | 'daytona' | 'e2b' | 'mock';

export interface RunInput {
  command: string;
  cwd: string;
  timeoutMs: number;
}

export interface RunOutput {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Backend que ejecutó realmente (puede diferir si hubo fallback). */
  backend: BackendId;
  /** Latencia incluyendo overhead del backend. */
  durationMs: number;
}

export interface RunBackend {
  readonly id: BackendId;
  readonly label: string;
  /** Lista de envs necesarias para que el backend funcione. */
  requiredEnvVars(): string[];
  /** True si todas las credenciales están y el backend puede usarse. */
  isConfigured(): boolean;
  /** Ejecuta el comando y devuelve stdout/stderr/exitCode + telemetría. */
  run(input: RunInput): Promise<RunOutput>;
}

/** Snapshot legible para `/run_backends` o logs. */
export interface BackendStatus {
  id: BackendId;
  label: string;
  configured: boolean;
  requires: string[];
}
