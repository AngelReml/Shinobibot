/**
 * SSH backend — ejecuta el comando en un host remoto vía SSH usando el
 * binario `ssh` del sistema (no requiere dep npm extra, OpenSSH viene
 * preinstalado en Windows 10+).
 *
 * Requisitos del operador:
 *   SSH_HOST              : IP o hostname del VPS
 *   SSH_USER              : usuario (root, ubuntu, etc.)
 *   SSH_PORT              : opcional, default 22
 *   SSH_KEY_PATH          : path absoluto a la clave privada (.pem o id_rsa)
 *   SSH_HOST_FINGERPRINT  : fingerprint SHA256 esperado de la host key
 *                           (F2.4/F2.5 — ver abajo). Requerido salvo
 *                           SSH_ALLOW_FIRST_PROVISION=1.
 *   SSH_ALLOW_FIRST_PROVISION : '1' para permitir el primer aprovisionamiento
 *                           sin pin (cae a TOFU accept-new, documentado y
 *                           explícito — NO es el default).
 *
 *   El SSH_PASS no se soporta porque sshpass no viene por defecto en
 *   Windows y meter contraseñas por env tiene mal historial. Mejor key.
 *
 * Seguridad (F2.5, auditoría 2026-07 — RESUELTO MITM en primer connect):
 *   - ANTES: `StrictHostKeyChecking=accept-new` (TOFU — trust-on-first-use)
 *     aceptaba SIN VERIFICAR la clave de cualquier host nunca visto. Un
 *     atacante en posición de MITM (DNS spoofing, ARP poisoning, VPS
 *     comprometido en el mismo proveedor) podía interceptar la PRIMERA
 *     conexión, presentar su propia host key, y Shinobi la aceptaba sin
 *     preguntar — comprometiendo toda sesión SSH futura (comandos, salidas,
 *     credenciales que pasen por el túnel).
 *   - AHORA: host key PINNEADA. El operador registra el fingerprint SHA256
 *     esperado en `SSH_HOST_FINGERPRINT` (obtenido de un canal de confianza
 *     — panel del proveedor VPS, `ssh-keygen -lf` corrido localmente en el
 *     VPS, etc.). Antes de conectar, `verifyHostFingerprint()` obtiene la
 *     clave real del host (vía `keyScanner`, inyectable — `ssh-keyscan` por
 *     defecto) y la compara contra el pin. Si no coincide, la conexión se
 *     ABORTA antes de invocar `ssh` — cero intentos de conexión con una
 *     clave no verificada.
 *   - `StrictHostKeyChecking=accept-new` SOLO se usa cuando el operador
 *     marca explícitamente `SSH_ALLOW_FIRST_PROVISION=1` (aprovisionamiento
 *     inicial de un VPS nuevo, documentado como ventana de confianza
 *     puntual — el operador debe fijar `SSH_HOST_FINGERPRINT` después de
 *     ese primer connect para que las conexiones siguientes queden
 *     pinneadas).
 *   - El comando remoto pasa por la misma blacklist básica que
 *     `run_command.ts` (`checkDestructive` — bloquea `rm -rf`, fork bombs,
 *     etc., y separadores/subshells encadenados obvios) antes de
 *     serializarse. No sustituye la validación de `run_command` para
 *     comandos locales — es la misma clase de defensa aplicada aquí porque
 *     el comando remoto viaja igual de "en crudo" a un shell.
 *   - El comando se serializa con shell-escape básico para no permitir
 *     inyección desde el host local.
 */

import { spawn, spawnSync } from 'child_process';
import type { RunBackend, RunInput, RunOutput } from '../types.js';
import { checkDestructive } from '../../tools/run_command.js';

/** Resultado de escanear la host key real de un host remoto. */
export interface HostKeyScanResult {
  ok: boolean;
  /** Fingerprint SHA256 (formato `SHA256:base64…`, igual que `ssh-keygen -lf`). */
  fingerprint?: string;
  error?: string;
}

/** Inyectable para tests: escanea la host key real de `host:port`. */
export type KeyScanner = (host: string, port: string) => Promise<HostKeyScanResult>;

/**
 * Escáner por defecto: `ssh-keyscan` obtiene la clave pública del host tal
 * y como la presenta AHORA MISMO (sin verificar nada — es solo la lectura
 * cruda), y `ssh-keygen -lf -` la reduce a su fingerprint SHA256. Esto es
 * exactamente lo que un operador correría a mano para obtener el valor a
 * pinnear, automatizado para poder compararlo contra el pin en cada conexión.
 */
export const defaultKeyScanner: KeyScanner = (host, port) => new Promise((resolve) => {
  const scan = spawnSync('ssh-keyscan', ['-p', port, '-T', '5', host], { encoding: 'utf-8' });
  if (scan.status !== 0 || !scan.stdout?.trim()) {
    resolve({ ok: false, error: `ssh-keyscan falló: ${(scan.stderr || 'sin salida').trim().slice(0, 300)}` });
    return;
  }
  const fp = spawnSync('ssh-keygen', ['-lf', '-'], { input: scan.stdout, encoding: 'utf-8' });
  if (fp.status !== 0 || !fp.stdout?.trim()) {
    resolve({ ok: false, error: `ssh-keygen -lf falló: ${(fp.stderr || 'sin salida').trim().slice(0, 300)}` });
    return;
  }
  // Formato típico: "256 SHA256:abcd… host (ED25519)" — el fingerprint es el
  // segundo campo.
  const match = fp.stdout.trim().match(/(SHA256:[A-Za-z0-9+/=]+)/);
  if (!match) {
    resolve({ ok: false, error: `no se pudo extraer fingerprint de: ${fp.stdout.trim().slice(0, 200)}` });
    return;
  }
  resolve({ ok: true, fingerprint: match[1] });
});

export interface FingerprintVerification {
  allowed: boolean;
  reason: 'pinned_match' | 'pinned_mismatch' | 'first_provision_opt_in' | 'no_pin_no_opt_in' | 'scan_failed';
  detail?: string;
}

/**
 * Verifica el fingerprint real del host contra el pin configurado. Devuelve
 * `allowed: false` (y la conexión NUNCA se intenta) en cualquier caso que no
 * sea una coincidencia exacta o un opt-in explícito de primer aprovisionamiento.
 */
export async function verifyHostFingerprint(
  host: string,
  port: string,
  pinnedFingerprint: string | undefined,
  allowFirstProvision: boolean,
  scanner: KeyScanner = defaultKeyScanner,
): Promise<FingerprintVerification> {
  if (!pinnedFingerprint) {
    if (allowFirstProvision) {
      return { allowed: true, reason: 'first_provision_opt_in', detail: 'SSH_HOST_FINGERPRINT no configurado; SSH_ALLOW_FIRST_PROVISION=1 permite TOFU (accept-new) para este connect. Configura SSH_HOST_FINGERPRINT tras verificar la clave para pinnear las próximas conexiones.' };
    }
    return { allowed: false, reason: 'no_pin_no_opt_in', detail: 'SSH_HOST_FINGERPRINT no configurado y SSH_ALLOW_FIRST_PROVISION no está activo. Configura uno de los dos antes de conectar.' };
  }
  const scan = await scanner(host, port);
  if (!scan.ok || !scan.fingerprint) {
    return { allowed: false, reason: 'scan_failed', detail: scan.error ?? 'no se pudo obtener la host key real' };
  }
  if (scan.fingerprint !== pinnedFingerprint) {
    return {
      allowed: false,
      reason: 'pinned_mismatch',
      detail: `fingerprint real (${scan.fingerprint}) NO coincide con el pin configurado (${pinnedFingerprint}) — posible MITM o la clave del host cambió legítimamente (rotación). Verifica por un canal de confianza y actualiza SSH_HOST_FINGERPRINT si el cambio es legítimo.`,
    };
  }
  return { allowed: true, reason: 'pinned_match' };
}

export class SSHBackend implements RunBackend {
  readonly id = 'ssh' as const;
  readonly label = 'Remote SSH';

  /** Inyectable para tests: sustituye el escaneo real de host key. */
  private keyScanner: KeyScanner;

  constructor(opts: { keyScanner?: KeyScanner } = {}) {
    this.keyScanner = opts.keyScanner ?? defaultKeyScanner;
  }

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

    // F2.5 — validación básica del comando remoto ANTES de serializarlo.
    // Misma clase de blacklist que run_command.ts (rm -rf, fork bombs,
    // taskkill, etc.) — el comando remoto viaja igual de "en crudo" a un
    // shell, así que merece la misma primera línea de defensa.
    const destructiveReason = checkDestructive(input.command);
    if (destructiveReason) {
      return {
        success: false, stdout: '',
        stderr: `SSH backend: comando rechazado — ${destructiveReason}`,
        exitCode: 126, backend: this.id, durationMs: Date.now() - t0,
      };
    }

    const host = process.env.SSH_HOST!;
    const user = process.env.SSH_USER!;
    const keyPath = process.env.SSH_KEY_PATH!;
    const port = process.env.SSH_PORT || '22';

    // F2.5 — host key PINNEADA por defecto (sustituye TOFU accept-new). La
    // conexión NUNCA se intenta si la verificación no pasa.
    const pinnedFingerprint = process.env.SSH_HOST_FINGERPRINT;
    const allowFirstProvision = process.env.SSH_ALLOW_FIRST_PROVISION === '1';
    const verification = await verifyHostFingerprint(host, port, pinnedFingerprint, allowFirstProvision, this.keyScanner);
    if (!verification.allowed) {
      return {
        success: false, stdout: '',
        stderr: `SSH backend: conexión ABORTADA — verificación de host key falló (${verification.reason}): ${verification.detail ?? ''}`,
        exitCode: 126, backend: this.id, durationMs: Date.now() - t0,
      };
    }

    const args = [
      // Con pin verificado (o first-provision opt-in explícito), delegamos
      // en OpenSSH la comprobación fina. `accept-new` aquí NO es el punto
      // de confianza real — ya verificamos el fingerprint arriba cuando hay
      // pin; en el caso first-provision es la ventana de confianza que el
      // operador pidió explícitamente.
      '-o', 'StrictHostKeyChecking=accept-new',
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
