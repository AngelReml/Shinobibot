/**
 * E2B backend — sandbox cloud "real" para code execution.
 *
 * E2B tiene un SDK JS oficial (`e2b`). Lo importamos dinámico como
 * los adapters de canales: si no está instalado, error claro pidiendo
 * `npm install e2b`.
 *
 * Requisitos:
 *   E2B_API_KEY (https://e2b.dev/dashboard)
 */

import type { RunBackend, RunInput, RunOutput } from '../types.js';

export async function runE2BCommand(sandbox: any, input: RunInput): Promise<any> {
  if (sandbox.commands?.run) {
    return sandbox.commands.run(input.command, { cwd: input.cwd, timeoutMs: input.timeoutMs });
  }
  if (sandbox.process?.start) {
    const proc = await sandbox.process.start({ cmd: input.command, cwd: input.cwd });
    return proc.wait({ timeoutMs: input.timeoutMs });
  }
  throw new Error('E2B sandbox no expone commands.run ni process.start');
}

export async function disposeE2BSandbox(sandbox: any): Promise<void> {
  if (sandbox.kill) await sandbox.kill();
  else if (sandbox.close) await sandbox.close();
}

export class E2BBackend implements RunBackend {
  readonly id = 'e2b' as const;
  readonly label = 'E2B (cloud sandbox)';

  requiredEnvVars(): string[] {
    return ['E2B_API_KEY'];
  }

  isConfigured(): boolean {
    return !!process.env.E2B_API_KEY;
  }

  async run(input: RunInput): Promise<RunOutput> {
    const t0 = Date.now();
    if (!this.isConfigured()) {
      return {
        success: false, stdout: '',
        stderr: 'E2B backend no configurado. Define E2B_API_KEY (https://e2b.dev/dashboard).',
        exitCode: 127, backend: this.id, durationMs: Date.now() - t0,
      };
    }
    // Dynamic import indirecto: dep opcional.
    const packages = ['e2b', '@e2b/sdk'];
    let e2b: any;
    let loadedPackage = '';
    try {
      for (const pkg of packages) {
        try {
          e2b = await import(pkg);
          loadedPackage = pkg;
          break;
        } catch {
          /* try the legacy package name */
        }
      }
      if (!e2b) throw new Error('E2B SDK not found');
    } catch {
      return {
        success: false, stdout: '',
        stderr: 'e2b no está instalado. Ejecuta: npm install e2b',
        exitCode: 127, backend: this.id, durationMs: Date.now() - t0,
      };
    }
    try {
      // Compatible with the modern `e2b` package and the legacy `@e2b/sdk` name.
      const Sandbox = e2b.Sandbox ?? e2b.default?.Sandbox;
      if (!Sandbox) throw new Error(`${loadedPackage}: Sandbox export no encontrado`);
      const sandbox = await Sandbox.create({ apiKey: process.env.E2B_API_KEY });
      try {
        const result = await runE2BCommand(sandbox, input);
        return {
          success: (result?.exitCode ?? 1) === 0,
          stdout: result?.stdout ?? '',
          stderr: result?.stderr ?? '',
          exitCode: result?.exitCode ?? 1,
          backend: this.id,
          durationMs: Date.now() - t0,
        };
      } finally {
        try { await disposeE2BSandbox(sandbox); } catch { /* swallow */ }
      }
    } catch (e: any) {
      return {
        success: false, stdout: '',
        stderr: `E2B run error: ${e?.message ?? e}`,
        exitCode: 1, backend: this.id, durationMs: Date.now() - t0,
      };
    }
  }
}
