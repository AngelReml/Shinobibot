/**
 * Helper común para los tools Windows-elite. Ejecuta un script PowerShell
 * con `powershell.exe -NoProfile -NonInteractive -EncodedCommand` y captura
 * stdout/stderr.
 *
 * El script se transporta como base64 UTF-16LE vía `-EncodedCommand`, en vez
 * de interpolarlo en `-Command "..."`. Esto elimina por completo el vector
 * de command injection (bug C3 de la auditoría 2026-05-16): no hay quoting
 * de cmd.exe que escapar, así que un valor del LLM con comillas dobles ya no
 * puede romper la línea de comandos. `psEscapeString`/`psLit` siguen siendo
 * necesarios para embeber valores DENTRO del script de forma segura.
 */

import { execFile } from 'child_process';

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
  return new Promise((resolve) => {
    // base64(UTF-16LE) — el formato que PowerShell espera en -EncodedCommand.
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    // execFile NO pasa por cmd.exe: los argumentos van directos al proceso,
    // sin parseo de shell intermedio. Junto con -EncodedCommand, cierra el
    // vector de inyección.
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { timeout: timeoutMs, encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error: any, stdout, stderr) => {
        resolve({
          success: !error,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          exitCode: typeof error?.code === 'number' ? error.code : (error ? 1 : 0),
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
