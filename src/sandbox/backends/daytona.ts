/**
 * Daytona backend — dev environments via Daytona REST API.
 *
 * Requisitos del operador:
 *   DAYTONA_API_KEY    : token de https://daytona.io
 *   DAYTONA_API_URL    : opcional, default https://api.daytona.io
 *
 * Implementación estructural: registra el backend con isConfigured() y
 * un placeholder de `run()` que documenta cómo activarlo. La integración
 * REST completa (POST /workspaces → exec → poll → fetch logs) queda
 * para el sprint cuando un usuario active el canal con credenciales.
 *
 * No instalamos SDK npm de Daytona (su API es REST estable; preferible
 * usar axios). Eso evita inflar el .exe portable.
 */

import axios from 'axios';
import type { RunBackend, RunInput, RunOutput } from '../types.js';

export class DaytonaBackend implements RunBackend {
  readonly id = 'daytona' as const;
  readonly label = 'Daytona (dev environment)';

  requiredEnvVars(): string[] {
    return ['DAYTONA_API_KEY'];
  }

  isConfigured(): boolean {
    return !!process.env.DAYTONA_API_KEY;
  }

  async run(input: RunInput): Promise<RunOutput> {
    const t0 = Date.now();
    if (!this.isConfigured()) {
      return {
        success: false, stdout: '',
        stderr: 'Daytona backend no configurado. Define DAYTONA_API_KEY (https://daytona.io).',
        exitCode: 127, backend: this.id, durationMs: Date.now() - t0,
      };
    }
    // Estructura del request real (cuando esté activo):
    const baseUrl = process.env.DAYTONA_API_URL || 'https://api.daytona.io';
    try {
      // Ping al endpoint de auth para verificar key; ejecución real
      // requiere workspace pre-aprovisionado por el operador.
      await axios.get(`${baseUrl}/health`, {
        headers: { Authorization: `Bearer ${process.env.DAYTONA_API_KEY}` },
        timeout: 8000,
      });
      return {
        success: false, stdout: '',
        stderr: '[daytona] credenciales OK; falta `DAYTONA_WORKSPACE_ID` y plumbing exec → logs. Cierra esto en sprint 3.x.',
        exitCode: 1, backend: this.id, durationMs: Date.now() - t0,
      };
    } catch (e: any) {
      return {
        success: false, stdout: '',
        stderr: `Daytona unreachable: ${e?.message ?? e}`,
        exitCode: 127, backend: this.id, durationMs: Date.now() - t0,
      };
    }
  }
}
