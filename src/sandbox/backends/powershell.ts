/**
 * PowerShell backend — envuelve `runPowerShell()` (`src/tools/_powershell.ts`)
 * detrás del contrato `RunBackend`, para que la ruta PowerShell de
 * `run_command.ts` pueda entrar por `mediatedEffect()` en vez de llamar al
 * helper directo.
 *
 * P1.E4 (plan de frontera 2026-07-01): antes de este backend, `run_command.ts`
 * tenía una brecha real y documentada en `monitor.ts` — "la ruta PowerShell...
 * sigue fuera de este monitor". Es la ruta por DEFECTO en el host Windows
 * nativo del producto (`shell:'auto'` + `process.platform==='win32'`), así que
 * era el hueco de mayor tráfico real del chokepoint. Este backend cierra esa
 * brecha con paridad exacta de comportamiento respecto al `runPowerShell()`
 * directo que sustituye — `_powershell.ts` ya tenía su propia defensa (F1.1:
 * `-EncodedCommand` sin inyección, env allowlist, redacción de output); este
 * backend no la reimplementa, solo la expone por el camino mediado.
 *
 * `cwd` NO se aplica (paridad con el comportamiento previo: `run_command.ts`
 * nunca pasó `cwd` a `runPowerShell` — el script corre en el cwd del proceso
 * Shinobi). Cambiarlo sería una funcionalidad nueva, no una migración; fuera
 * de alcance de este corte.
 */

import type { RunBackend, RunInput, RunOutput } from '../types.js';
import { runPowerShell } from '../../tools/_powershell.js';

export class PowerShellBackend implements RunBackend {
  readonly id = 'powershell' as const;
  readonly label = 'PowerShell (powershell.exe -EncodedCommand)';

  requiredEnvVars(): string[] { return []; }
  isConfigured(): boolean { return process.platform === 'win32'; }

  async run(input: RunInput): Promise<RunOutput> {
    const t0 = Date.now();
    const r = await runPowerShell(input.command, input.timeoutMs);
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
