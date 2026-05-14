/**
 * E2B backend — sandbox cloud "real" para code execution.
 *
 * E2B tiene un SDK JS oficial (`@e2b/sdk`). Lo importamos dinámico como
 * los adapters de canales: si no está instalado, error claro pidiendo
 * `npm install @e2b/sdk`.
 *
 * Requisitos:
 *   E2B_API_KEY (https://e2b.dev/dashboard)
 */

import type { RunBackend, RunInput, RunOutput } from '../types.js';

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
    const pkg = '@e2b/sdk';
    let e2b: any;
    try {
      e2b = await import(pkg);
    } catch {
      return {
        success: false, stdout: '',
        stderr: '@e2b/sdk no está instalado. Ejecuta: npm install @e2b/sdk',
        exitCode: 127, backend: this.id, durationMs: Date.now() - t0,
      };
    }
    try {
      // Patrón típico SDK E2B (v0.x): Sandbox.create + sandbox.process.startAndWait.
      const Sandbox = e2b.Sandbox ?? e2b.default?.Sandbox;
      if (!Sandbox) throw new Error('@e2b/sdk: Sandbox export no encontrado');
      const sandbox = await Sandbox.create({ apiKey: process.env.E2B_API_KEY });
      try {
        const proc = await sandbox.process.start({ cmd: input.command, cwd: input.cwd });
        const result = await proc.wait({ timeoutMs: input.timeoutMs });
        return {
          success: (result?.exitCode ?? 1) === 0,
          stdout: result?.stdout ?? '',
          stderr: result?.stderr ?? '',
          exitCode: result?.exitCode ?? 1,
          backend: this.id,
          durationMs: Date.now() - t0,
        };
      } finally {
        try { await sandbox.close(); } catch { /* swallow */ }
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
