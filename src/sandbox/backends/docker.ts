/**
 * Docker backend — container ephemeral via `docker run`.
 *
 * Reutiliza la lógica ya commiteada en `src/tools/_docker_backend.ts`
 * (validateDockerImage, buildDockerRunArgs, runInDocker,
 * isDockerAvailable) para no duplicar. Aquí adaptamos a la interfaz
 * `RunBackend`.
 */

import type { RunBackend, RunInput, RunOutput } from '../types.js';
import { isDockerAvailable, runInDocker } from '../../tools/_docker_backend.js';

export class DockerBackend implements RunBackend {
  readonly id = 'docker' as const;
  readonly label = 'Docker (ephemeral container)';

  requiredEnvVars(): string[] {
    return []; // El binario `docker` no es env var, pero requiere instalación.
  }

  /**
   * Hasta que llamamos `isDockerAvailable` realmente no sabemos. Para
   * mantener `isConfigured` sincrónico, devolvemos true SIEMPRE: si al
   * ejecutar el cliente Docker falla, devolvemos exitCode != 0 con
   * stderr descriptivo. Eso es lo mismo que hacer el `run_command`
   * actual.
   *
   * Para diagnóstico (`/run_backends`) hay `probe()` async opcional.
   */
  isConfigured(): boolean {
    return true;
  }

  async probe(): Promise<{ available: boolean; error?: string }> {
    return isDockerAvailable();
  }

  async run(input: RunInput): Promise<RunOutput> {
    const t0 = Date.now();
    const dock = await isDockerAvailable();
    if (!dock.available) {
      return {
        success: false,
        stdout: '',
        stderr: dock.error || 'docker no disponible',
        exitCode: 127,
        backend: this.id,
        durationMs: Date.now() - t0,
      };
    }
    const r = await runInDocker({ command: input.command, cwd: input.cwd, timeoutMs: input.timeoutMs });
    return {
      success: r.success,
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.exitCode,
      backend: this.id,
      durationMs: Date.now() - t0,
    };
  }
}
