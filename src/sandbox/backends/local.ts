/**
 * Local backend — `child_process.exec` en el host de Shinobi.
 *
 * Es el default histórico de `run_command`. No requiere ninguna
 * credencial. Aquí lo encapsulamos detrás del contrato `RunBackend` para
 * que el `registry` lo tenga registrado igual que los demás.
 */

import { exec } from 'child_process';
import type { RunBackend, RunInput, RunOutput } from '../types.js';

export class LocalBackend implements RunBackend {
  readonly id = 'local' as const;
  readonly label = 'Local host';

  requiredEnvVars(): string[] { return []; }
  isConfigured(): boolean { return true; }

  async run(input: RunInput): Promise<RunOutput> {
    const t0 = Date.now();
    return new Promise((resolve) => {
      exec(input.command, {
        cwd: input.cwd,
        timeout: input.timeoutMs,
        encoding: 'utf-8',
        maxBuffer: 4 * 1024 * 1024,
      }, (err, stdout, stderr) => {
        resolve({
          success: !err,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          exitCode: (err?.code as number) ?? 0,
          backend: this.id,
          durationMs: Date.now() - t0,
        });
      });
    });
  }
}
