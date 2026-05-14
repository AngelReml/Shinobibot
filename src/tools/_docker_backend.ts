/**
 * Docker backend opcional para `run_command`.
 *
 * Cuando `SHINOBI_RUN_BACKEND=docker` está set, el comando se ejecuta
 * dentro de un container ephemeral en vez de en el host. Esto le da
 * isolación de filesystem (solo el cwd se montea) y de proceso, aún
 * cuando el LLM intente algo destructivo.
 *
 * NO es un sandbox full — es una capa adicional. La blacklist destructiva
 * y el sandbox de cwd siguen aplicando ANTES del backend Docker.
 *
 * Imagen por defecto: `alpine:latest` (5MB, shell `sh`). Configurable via
 * `SHINOBI_DOCKER_IMAGE`. Solo se aceptan tags con caracteres de
 * referencia estándar de Docker (rechaza inyección via flags).
 *
 * Diferenciador: Hermes tiene 7 terminal backends pero la mayoría son
 * experimentales (Modal, Daytona, Singularity). OpenClaw no tiene sandbox
 * OS real. Shinobi añade UN backend sólido (Docker) que la mayoría de
 * desarrolladores ya tiene instalado.
 */

import { exec } from 'child_process';

const DOCKER_IMAGE_RE = /^[a-z0-9][a-z0-9._\-/:]{0,127}$/i;
const DEFAULT_IMAGE = 'alpine:latest';

export interface DockerExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Verifica que `docker --version` ejecuta OK. Cachea el resultado para
 * evitar el sub-process en cada llamada.
 */
let _availabilityCache: { checked: boolean; available: boolean; error?: string } = { checked: false, available: false };

export function _resetDockerAvailability(): void {
  _availabilityCache = { checked: false, available: false };
}

export function isDockerAvailable(): Promise<{ available: boolean; error?: string }> {
  if (_availabilityCache.checked) {
    return Promise.resolve({ available: _availabilityCache.available, error: _availabilityCache.error });
  }
  return new Promise((resolve) => {
    exec('docker --version', { timeout: 5000, encoding: 'utf-8' }, (err) => {
      const available = !err;
      _availabilityCache = {
        checked: true,
        available,
        error: err ? `docker no disponible: ${err.message}` : undefined,
      };
      resolve({ available, error: _availabilityCache.error });
    });
  });
}

/**
 * Valida el nombre/tag de la imagen Docker. Devuelve la imagen segura o
 * lanza si el formato es sospechoso (intenta evitar inyección de flags).
 */
export function validateDockerImage(image: string): string {
  if (!image || typeof image !== 'string') throw new Error('imagen Docker vacía');
  if (image.startsWith('-')) throw new Error('imagen Docker no puede empezar con "-" (parecería flag)');
  if (!DOCKER_IMAGE_RE.test(image)) throw new Error(`imagen Docker inválida: ${image}`);
  return image;
}

/**
 * Construye los argumentos para `docker run`. NO ejecuta nada — facilita
 * tests sin levantar Docker.
 *
 * Política:
 *   - --rm para que el container se borre tras terminar.
 *   - --network=none por defecto (sin red); el LLM puede pedirlo explícito
 *     vía args.network='bridge' si necesita curl/git fetch.
 *   - cwd se monta en /workspace y se usa como working dir.
 *   - sh -c "<command>" — el caller no debe escapar shell args; el shell
 *     del container lo hace. (Defendido por la blacklist destructiva
 *     que ya filtró el comando antes de llegar aquí.)
 */
export function buildDockerRunArgs(opts: {
  image: string;
  command: string;
  cwd: string;
  network?: 'none' | 'bridge';
}): string[] {
  const image = validateDockerImage(opts.image);
  const network = opts.network === 'bridge' ? 'bridge' : 'none';
  return [
    'run',
    '--rm',
    `--network=${network}`,
    '-v',
    `${opts.cwd}:/workspace`,
    '-w',
    '/workspace',
    image,
    'sh',
    '-c',
    opts.command,
  ];
}

/**
 * Ejecuta el comando dentro de Docker y devuelve stdout/stderr/exitCode.
 */
export function runInDocker(opts: {
  command: string;
  cwd: string;
  image?: string;
  network?: 'none' | 'bridge';
  timeoutMs?: number;
}): Promise<DockerExecResult> {
  const image = opts.image || process.env.SHINOBI_DOCKER_IMAGE || DEFAULT_IMAGE;
  const args = buildDockerRunArgs({
    image,
    command: opts.command,
    cwd: opts.cwd,
    network: opts.network,
  });
  // Componemos un string con shell-escaping mínimo para `exec`. Los args
  // que no llevan espacios/comillas no se tocan; los que sí, los envolvemos
  // en comillas simples y duplicamos quotes internas.
  const escaped = args
    .map((a) => /^[\w@.\-/:=]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)
    .join(' ');
  const cmd = `docker ${escaped}`;
  const timeout = opts.timeoutMs ?? 60_000;
  return new Promise((resolve) => {
    exec(cmd, { timeout, encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        success: !err,
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        exitCode: (err?.code as number) ?? 0,
      });
    });
  });
}
