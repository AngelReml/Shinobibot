/**
 * Mock backend — determinista, sin red, para tests y demos.
 *
 * Útil para demostrar que la fachada `RunBackend` funciona idéntica
 * para todos los backends sin necesidad de credenciales reales. El
 * script funcional del Sprint 1.4 lo usa como "3er backend" cuando el
 * operador no tiene Docker o SSH configurados.
 */

import type { RunBackend, RunInput, RunOutput } from '../types.js';

export interface MockBackendOptions {
  /** id custom para registrar varias instancias (mock, mock_remote, ...). */
  id?: string;
  /** Label legible. */
  label?: string;
  /** Output que devolverá `run()`. Default: echo del comando. */
  scriptedOutput?: (cmd: string) => { stdout: string; stderr: string; exitCode: number };
  /** Latencia simulada en ms. Default 0. */
  fakeLatencyMs?: number;
}

export class MockBackend implements RunBackend {
  readonly id: any;
  readonly label: string;
  private readonly cfg: MockBackendOptions;

  constructor(cfg: MockBackendOptions = {}) {
    this.cfg = cfg;
    this.id = (cfg.id ?? 'mock') as any;
    this.label = cfg.label ?? 'Mock (in-process scripted)';
  }

  requiredEnvVars(): string[] { return []; }
  isConfigured(): boolean { return true; }

  async run(input: RunInput): Promise<RunOutput> {
    const t0 = Date.now();
    if (this.cfg.fakeLatencyMs && this.cfg.fakeLatencyMs > 0) {
      await new Promise(r => setTimeout(r, this.cfg.fakeLatencyMs));
    }
    const out = this.cfg.scriptedOutput
      ? this.cfg.scriptedOutput(input.command)
      : { stdout: `[mock] echo: ${input.command}\n`, stderr: '', exitCode: 0 };
    return {
      success: out.exitCode === 0,
      stdout: out.stdout,
      stderr: out.stderr,
      exitCode: out.exitCode,
      backend: this.id,
      durationMs: Date.now() - t0,
    };
  }
}
