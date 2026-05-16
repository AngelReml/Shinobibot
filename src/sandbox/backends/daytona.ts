/**
 * Daytona backend — STUB NO FUNCIONAL.
 *
 * La integración REST completa con Daytona (POST /workspaces → exec → poll →
 * logs) no está implementada. Por honestidad (auditoría 2026-05-16):
 * `isConfigured()` devuelve `false` SIEMPRE para que el registry NO lo
 * presente como backend de ejecución usable, y `run()` devuelve un error
 * claro en vez de fingir trabajo.
 *
 * Para ejecución aislada real: usa `SHINOBI_RUN_BACKEND=docker` o `ssh`.
 */

import type { RunBackend, RunInput, RunOutput } from '../types.js';

export class DaytonaBackend implements RunBackend {
  readonly id = 'daytona' as const;
  readonly label = 'Daytona (dev environment) — stub no funcional';

  requiredEnvVars(): string[] {
    return ['DAYTONA_API_KEY'];
  }

  /** Siempre false: es un stub; no debe presentarse como backend usable. */
  isConfigured(): boolean {
    return false;
  }

  async run(_input: RunInput): Promise<RunOutput> {
    return {
      success: false,
      stdout: '',
      stderr: 'Daytona backend es un STUB no funcional (integración REST exec→logs no implementada). ' +
        'Usa SHINOBI_RUN_BACKEND=docker o ssh para ejecución aislada real.',
      exitCode: 127,
      backend: this.id,
      durationMs: 0,
    };
  }
}
