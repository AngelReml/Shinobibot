/**
 * Local backend — `child_process.exec` en el host de Shinobi.
 *
 * Es el default histórico de `run_command`. No requiere ninguna
 * credencial. Aquí lo encapsulamos detrás del contrato `RunBackend` para
 * que el `registry` lo tenga registrado igual que los demás.
 *
 * F1.1 (auditoría 2026-07, RANK #1 — mayor superficie de daño directo del
 * repo): antes este backend era un "ejecutor tonto" — `child_process.exec`
 * sin ninguna defensa propia, heredaba `process.env` completo (fuga de API
 * keys al comando hijo, sin redacción del output), sin jail de directorio
 * real, y su única "seguridad" era una blacklist EXTERNA que no vivía aquí
 * (dependía de que `run_command.ts` la aplicara antes de llegar a este
 * backend — pero `sandboxRegistry().get('local')` puede invocarse desde
 * otros callers, como `shugyo`, sin pasar por esa capa). Ahora el backend
 * se defiende a sí mismo, sin confiar en el caller:
 *
 *   1. Blacklist/allowlist de comandos: reusa `checkDestructive` +
 *      `checkProhibitedPaths` + `checkSandbox` de `tools/run_command.ts`
 *      (CRIT-01/CRIT-02/ALTA-01, ya endurecidos y testeados) — NO se
 *      reinventa la lógica, se importa la misma fuente.
 *   2. Env allowlisting: deja de heredar `process.env` completo. Solo pasa
 *      al proceso hijo una allowlist mínima de variables de sistema
 *      (`SAFE_ENV_ALLOWLIST`), extensible por el operador vía
 *      `SHINOBI_RUN_ENV_EXTRA_ALLOWLIST` (CSV de nombres adicionales,
 *      opt-in explícito y auditable — no un blocklist de "todo lo que
 *      huela a secreto", que siempre es incompleto).
 *   3. Redacción de output: stdout/stderr pasan por `redactSecrets` antes
 *      de devolverse — si el comando imprime una variable de entorno con
 *      forma de secreto (aun estando en la allowlist, p. ej. un valor que
 *      un script escribe a stdout), no sale en claro.
 *   4. Jail de directorio: `checkSandbox` ya resuelve symlinks vía
 *      `realpathSync` (mismo patrón que CRIT-03 de `run_command.ts`) y
 *      rechaza si `cwd` escapa el workspace.
 *
 * Ver DECISIONES.md (F1.1) para la política de env y su justificación.
 */

import { exec } from 'child_process';
import type { RunBackend, RunInput, RunOutput } from '../types.js';
import { checkDestructive, checkProhibitedPaths, checkSandbox } from '../../tools/run_command.js';
import { redactSecrets } from '../../security/secret_redactor.js';

/**
 * Variables de entorno de sistema que un comando normal necesita para
 * funcionar (localizar binarios, resolver rutas temporales, etc.) y que
 * NUNCA contienen secretos por diseño del propio SO. Todo lo demás
 * (API keys, tokens, credenciales del proceso Shinobi) se excluye por
 * defecto — el comando hijo ya no ve `process.env` completo.
 */
export const SAFE_ENV_ALLOWLIST: readonly string[] = [
  // Windows
  'PATH', 'Path', 'SystemRoot', 'windir', 'WINDIR', 'TEMP', 'TMP',
  'USERPROFILE', 'USERNAME', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA',
  'LOCALAPPDATA', 'ComSpec', 'PATHEXT', 'OS', 'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'PROCESSOR_LEVEL',
  'PROCESSOR_REVISION', 'PUBLIC', 'ALLUSERSPROFILE', 'ProgramData',
  'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'CommonProgramFiles',
  'CommonProgramFiles(x86)', 'DriverData',
  // POSIX (sandbox de test / futuros hosts Linux)
  'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TERM',
  // Runtime (necesarios para que `node`/`npm`/`npx` funcionen dentro del comando)
  'NODE_PATH', 'npm_config_cache',
] as const;

/** Nombre de la env var que permite al operador extender la allowlist. */
const EXTRA_ALLOWLIST_ENV = 'SHINOBI_RUN_ENV_EXTRA_ALLOWLIST';

/**
 * Construye el `env` que se pasa al proceso hijo: solo las variables de
 * `SAFE_ENV_ALLOWLIST` (más las que el operador añadió explícitamente vía
 * `SHINOBI_RUN_ENV_EXTRA_ALLOWLIST`) que de verdad existen en
 * `process.env`. Nunca hereda el resto.
 */
export function buildSafeChildEnv(sourceEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const extra = (sourceEnv[EXTRA_ALLOWLIST_ENV] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowed = new Set([...SAFE_ENV_ALLOWLIST, ...extra]);
  const out: Record<string, string> = {};
  for (const name of allowed) {
    const v = sourceEnv[name];
    if (v !== undefined) out[name] = v;
  }
  return out;
}

export class LocalBackend implements RunBackend {
  readonly id = 'local' as const;
  readonly label = 'Local host';

  requiredEnvVars(): string[] { return []; }
  isConfigured(): boolean { return true; }

  async run(input: RunInput): Promise<RunOutput> {
    const t0 = Date.now();

    // F1.1 — defensa propia del backend, no confía en que el caller ya
    // haya validado. Mismo orden que `run_command.ts::execute()`.
    const destructiveError = checkDestructive(input.command);
    if (destructiveError) {
      return { success: false, stdout: '', stderr: destructiveError, exitCode: 1, backend: this.id, durationMs: Date.now() - t0 };
    }
    const prohibitedPathError = checkProhibitedPaths(input.command);
    if (prohibitedPathError) {
      return { success: false, stdout: '', stderr: prohibitedPathError, exitCode: 1, backend: this.id, durationMs: Date.now() - t0 };
    }
    const sandboxError = checkSandbox(input.command, input.cwd);
    if (sandboxError) {
      return { success: false, stdout: '', stderr: sandboxError, exitCode: 1, backend: this.id, durationMs: Date.now() - t0 };
    }

    const childEnv = buildSafeChildEnv();

    return new Promise((resolve) => {
      exec(input.command, {
        cwd: input.cwd,
        timeout: input.timeoutMs,
        encoding: 'utf-8',
        maxBuffer: 4 * 1024 * 1024,
        env: childEnv,
      }, (err, stdout, stderr) => {
        const redactedStdout = redactSecrets(stdout ?? '').text;
        const redactedStderr = redactSecrets(stderr ?? '').text;
        resolve({
          success: !err,
          stdout: redactedStdout,
          stderr: redactedStderr,
          exitCode: (err?.code as number) ?? 0,
          backend: this.id,
          durationMs: Date.now() - t0,
        });
      });
    });
  }
}
