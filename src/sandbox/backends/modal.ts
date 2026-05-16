/**
 * Modal backend — STUB NO FUNCIONAL.
 *
 * La ejecución real en Modal necesita un wrapper (el SDK de Modal es Python,
 * sin homólogo JS oficial) que este proyecto no implementa. Por honestidad
 * (auditoría 2026-05-16): `isConfigured()` devuelve `false` SIEMPRE para que
 * el registry NO lo presente como un backend de ejecución usable, y `run()`
 * devuelve un error claro en vez de simular trabajo.
 *
 * Para ejecución aislada real: usa `SHINOBI_RUN_BACKEND=docker` o `ssh`.
 */

import type { RunBackend, RunInput, RunOutput } from '../types.js';

export class ModalBackend implements RunBackend {
  readonly id = 'modal' as const;
  readonly label = 'Modal (serverless container) — stub no funcional';

  requiredEnvVars(): string[] {
    return ['MODAL_TOKEN_ID', 'MODAL_TOKEN_SECRET'];
  }

  /** Siempre false: es un stub; no debe presentarse como backend usable. */
  isConfigured(): boolean {
    return false;
  }

  async run(_input: RunInput): Promise<RunOutput> {
    return {
      success: false,
      stdout: '',
      stderr: 'Modal backend es un STUB no funcional (sin wrapper de ejecución implementado). ' +
        'Usa SHINOBI_RUN_BACKEND=docker o ssh para ejecución aislada real.',
      exitCode: 127,
      backend: this.id,
      durationMs: 0,
    };
  }
}
