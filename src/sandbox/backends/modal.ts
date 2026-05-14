/**
 * Modal backend — Modal serverless container ephemeral.
 *
 * Requisitos del operador:
 *   MODAL_TOKEN_ID, MODAL_TOKEN_SECRET (modal.com/settings/tokens)
 *
 * Implementación: este sprint deja el backend ESTRUCTURAL pero usable
 * solo si el operador instala el CLI `modal` y configura tokens. La
 * ejecución real delega al binario `modal run` con un wrapper Python
 * inline.
 *
 * Justificación de no hacerlo full nativo aquí: el SDK Python de Modal
 * no tiene homólogo JS oficial, y los wrappers Modal.com vienen
 * cambiando. Para mantener el sprint dentro de su scope (arquitectura,
 * no integraciones de terceros completas), confiamos en el CLI.
 */

import { exec } from 'child_process';
import type { RunBackend, RunInput, RunOutput } from '../types.js';

export class ModalBackend implements RunBackend {
  readonly id = 'modal' as const;
  readonly label = 'Modal (serverless container)';

  requiredEnvVars(): string[] {
    return ['MODAL_TOKEN_ID', 'MODAL_TOKEN_SECRET'];
  }

  isConfigured(): boolean {
    return !!(process.env.MODAL_TOKEN_ID && process.env.MODAL_TOKEN_SECRET);
  }

  async run(input: RunInput): Promise<RunOutput> {
    const t0 = Date.now();
    if (!this.isConfigured()) {
      return {
        success: false, stdout: '',
        stderr: `Modal backend no configurado. Faltan: ${this.requiredEnvVars().join(', ')}. Sigue https://modal.com/docs/guide/tokens.`,
        exitCode: 127, backend: this.id, durationMs: Date.now() - t0,
      };
    }
    // Intento llamar al CLI `modal`. Si no está instalado → error claro.
    return new Promise((resolve) => {
      const wrappedCmd = `modal run --remote 'echo MODAL_NOT_IMPLEMENTED'`;
      exec(wrappedCmd, { timeout: input.timeoutMs, encoding: 'utf-8' }, (err, stdout, stderr) => {
        resolve({
          success: false, // Por ahora siempre false hasta wrapper completo
          stdout: stdout ?? '',
          stderr: (stderr ?? '') + '\n[modal backend pendiente] El CLI Modal todavía no implementa un eval-cmd directo; sprint 3.x lo cierra con wrapper Python embebido.',
          exitCode: err ? ((err.code as number) ?? 1) : 1,
          backend: this.id,
          durationMs: Date.now() - t0,
        });
      });
    });
  }
}
