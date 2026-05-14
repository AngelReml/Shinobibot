/**
 * SSH backend — ejecuta el comando en un host remoto vía SSH usando el
 * binario `ssh` del sistema (no requiere dep npm extra, OpenSSH viene
 * preinstalado en Windows 10+).
 *
 * Requisitos del operador:
 *   SSH_HOST           : IP o hostname del VPS
 *   SSH_USER           : usuario (root, ubuntu, etc.)
 *   SSH_PORT           : opcional, default 22
 *   SSH_KEY_PATH       : path absoluto a la clave privada (.pem o id_rsa)
 *
 *   El SSH_PASS no se soporta porque sshpass no viene por defecto en
 *   Windows y meter contraseñas por env tiene mal historial. Mejor key.
 *
 * Seguridad:
 *   - StrictHostKeyChecking=no para evitar prompt interactivo. Riesgo
 *     conocido: MITM en primer connect. Para ambientes serios el
 *     operador debe pre-popular `~/.ssh/known_hosts`.
 *   - El comando se serializa con shell-escape básico para no permitir
 *     inyección desde el host local.
 */

import { spawn } from 'child_process';
import type { RunBackend, RunInput, RunOutput } from '../types.js';

export class SSHBackend implements RunBackend {
  readonly id = 'ssh' as const;
  readonly label = 'Remote SSH';

  requiredEnvVars(): string[] {
    return ['SSH_HOST', 'SSH_USER', 'SSH_KEY_PATH'];
  }

  isConfigured(): boolean {
    return !!(process.env.SSH_HOST && process.env.SSH_USER && process.env.SSH_KEY_PATH);
  }

  async run(input: RunInput): Promise<RunOutput> {
    const t0 = Date.now();
    if (!this.isConfigured()) {
      return {
        success: false, stdout: '',
        stderr: `SSH backend no configurado. Faltan: ${this.requiredEnvVars().filter(k => !process.env[k]).join(', ')}`,
        exitCode: 127, backend: this.id, durationMs: Date.now() - t0,
      };
    }
    const host = process.env.SSH_HOST!;
    const user = process.env.SSH_USER!;
    const keyPath = process.env.SSH_KEY_PATH!;
    const port = process.env.SSH_PORT || '22';

    const args = [
      '-o', 'StrictHostKeyChecking=no',
      '-o', `ConnectTimeout=10`,
      '-o', 'BatchMode=yes',
      '-i', keyPath,
      '-p', port,
      `${user}@${host}`,
      // Forzamos `cd <cwd> &&` para imitar la semántica de cwd local.
      `cd ${shellQuote(input.cwd)} && ${input.command}`,
    ];

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      const proc = spawn('ssh', args, { timeout: input.timeoutMs });
      proc.stdout?.on('data', (b) => { stdout += b.toString('utf-8'); });
      proc.stderr?.on('data', (b) => { stderr += b.toString('utf-8'); });
      proc.on('error', (e) => {
        resolve({
          success: false, stdout, stderr: stderr + '\nspawn error: ' + e.message,
          exitCode: 127, backend: this.id, durationMs: Date.now() - t0,
        });
      });
      proc.on('close', (code) => {
        resolve({
          success: code === 0,
          stdout, stderr,
          exitCode: code ?? -1,
          backend: this.id,
          durationMs: Date.now() - t0,
        });
      });
    });
  }
}

/** Shell escape minimal para concatenar dentro de `bash -c '...'` remoto. */
function shellQuote(s: string): string {
  if (/^[\w@.\-/:=]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
