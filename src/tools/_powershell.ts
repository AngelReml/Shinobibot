/**
 * Helper común para los tools Windows-elite. Ejecuta un script PowerShell
 * con `powershell.exe -NoProfile -NonInteractive -EncodedCommand` y captura
 * stdout/stderr.
 *
 * El script se pasa como base64 (UTF-16LE) vía `-EncodedCommand` en vez de
 * `-Command "..."`. Esto elimina por completo el problema de quoting de
 * cmd.exe: no hay comillas que escapar, así que ningún `"` en un valor
 * dinámico puede romper el comando ni inyectar. Los callers siguen usando
 * `psLit()` para que los valores sean literales seguros DENTRO de PowerShell.
 */

import { exec } from 'child_process';

export interface PsRunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Ejecuta un script PowerShell ya construido. El caller es responsable de
 * escapar valores dinámicos con `psEscapeString`.
 */
export function runPowerShell(script: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<PsRunResult> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    exec(
      `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
      { timeout: timeoutMs, encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          success: !error,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          exitCode: (error?.code as number) ?? 0,
        });
      }
    );
  });
}

/**
 * Escapa un string para ser usado dentro de una cadena PowerShell entre
 * comillas simples ('...'). En PowerShell, dentro de single-quoted strings
 * solo hay que duplicar las single-quotes: 'foo''s value'. Es la forma más
 * segura porque NO interpreta $variables ni `caracteres especiales.
 */
export function psEscapeString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Construye literal PowerShell single-quoted seguro para concatenar en un
 * script. Ej: `Set-Clipboard -Value ${psLit(text)}` produce
 * `Set-Clipboard -Value 'texto seguro''s'`.
 */
export function psLit(value: string): string {
  return `'${psEscapeString(value)}'`;
}

/**
 * Intenta parsear stdout como JSON. Si falla, devuelve null.
 */
export function tryParseJson<T = any>(stdout: string): T | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}
