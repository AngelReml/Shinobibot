/**
 * Loop Detector — dos capas:
 *
 *   1) Capa de args (v1, ya commiteada en el orchestrator):
 *      SHA256(toolName + JSON.stringify(args)). El N-ésimo intento idéntico
 *      (default N=2) aborta con `LOOP_DETECTED`. Barato, exacto, captura el
 *      caso "el agente reintenta la misma llamada esperando un milagro".
 *
 *   2) Capa semántica (v2, este módulo):
 *      Fingerprint reducido del output (timestamps/paths/duraciones/números
 *      grandes normalizados → tokens placeholder, lowercase, collapse
 *      whitespace, truncado a 200 chars). El M-ésimo output indistinguible
 *      para la misma tool (default M=3) aborta con `LOOP_NO_PROGRESS`.
 *      Captura el caso "el LLM rota un parámetro irrelevante en cada
 *      intento pero el resultado observable es el mismo".
 *
 * Diferencia clave vs Hermes (no tiene loop detector) y OpenClaw (sin
 * detector explícito): aquí hay DOS señales independientes — incluso si
 * el agente intenta esquivar la primera, la segunda lo caza.
 *
 * Diseño:
 *   - El detector mantiene estado por sesión (un LoopDetector por
 *     executeToolLoop).
 *   - `recordCallAttempt` se llama ANTES de ejecutar la tool. Si la capa de
 *     args detecta repetición, devuelve `{ abort: true, verdict: 'LOOP_DETECTED' }`.
 *   - `recordCallResult` se llama DESPUÉS de ejecutar la tool. Si la capa
 *     semántica detecta no-progress, devuelve `{ abort: true,
 *     verdict: 'LOOP_NO_PROGRESS' }`.
 *   - Ambos métodos devuelven `{ abort: false }` cuando no hay problema.
 */

import { createHash } from 'crypto';

export type LoopVerdict = 'LOOP_DETECTED' | 'LOOP_NO_PROGRESS';

export interface LoopDetectorConfig {
  /** Repeticiones del mismo hash de args que disparan abort (default 2). */
  maxRepeatArgs?: number;
  /**
   * Outputs indistinguibles (mismo fingerprint reducido para la misma tool)
   * que disparan abort (default 3).
   */
  maxSameOutput?: number;
  /** Longitud máxima del fingerprint reducido (default 200 chars). */
  fingerprintLength?: number;
}

export interface LoopCheckResult {
  abort: boolean;
  verdict?: LoopVerdict;
  reason?: string;
  hash?: string;
}

const DEFAULTS: Required<LoopDetectorConfig> = {
  maxRepeatArgs: 2,
  maxSameOutput: 3,
  fingerprintLength: 200,
};

/**
 * Normaliza un output para fingerprinting: quita timestamps, paths Windows
 * absolutos, números muy grandes (probables timestamps Unix), duraciones,
 * minúsculas, colapsa whitespace, trunca.
 *
 * Exportada para que los tests puedan ejercitarla.
 */
export function reduceOutputForFingerprint(output: unknown, maxLen = 200): string {
  if (output == null) return '';
  let s: string;
  if (typeof output === 'string') s = output;
  else {
    try {
      s = JSON.stringify(output);
    } catch {
      s = String(output);
    }
  }
  if (!s) return '';

  s = s.toLowerCase();
  // ISO timestamps tipo 2026-05-14T10:30:45Z, 2026-05-14 10:30:45.123
  s = s.replace(/\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}:\d{2}(\.\d+)?z?/gi, '<ts>');
  // Timestamps Unix (10+ dígitos seguidos)
  s = s.replace(/\b\d{10,}\b/g, '<ts>');
  // Paths Windows absolutos (c:\foo\bar o c:/foo/bar)
  s = s.replace(/\b[a-z]:[\\/][^\s"']+/g, '<path>');
  // Duraciones tipo "12ms", "1.4s"
  s = s.replace(/\b\d+(?:\.\d+)?\s*(?:ms|µs|us|ns|sec|seconds?)\b/g, '<dur>');
  // Hex hashes largos
  s = s.replace(/\b[0-9a-f]{16,}\b/g, '<hex>');
  // Colapsa whitespace
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export class LoopDetector {
  private readonly cfg: Required<LoopDetectorConfig>;
  private readonly argsCounts = new Map<string, number>();
  /** Map<toolName + ':' + fingerprint, count>. */
  private readonly outputCounts = new Map<string, number>();

  constructor(cfg: LoopDetectorConfig = {}) {
    this.cfg = { ...DEFAULTS, ...cfg };
  }

  /**
   * Capa 1 (args). Llamar antes de ejecutar la tool.
   * Si devuelve `abort: true`, el orchestrator debe parar.
   */
  recordCallAttempt(toolName: string, args: unknown): LoopCheckResult {
    const hash = sha256(toolName + JSON.stringify(args));
    const prev = this.argsCounts.get(hash) ?? 0;
    if (prev >= this.cfg.maxRepeatArgs - 1) {
      // Ya hubo (maxRepeatArgs - 1) intentos previos; este sería el N-ésimo.
      return {
        abort: true,
        verdict: 'LOOP_DETECTED',
        reason: 'args_repeated',
        hash,
      };
    }
    this.argsCounts.set(hash, prev + 1);
    return { abort: false, hash };
  }

  /**
   * Capa 2 (output). Llamar después de ejecutar la tool, con el resultado.
   * Si devuelve `abort: true`, el orchestrator debe parar.
   *
   * Se ignora si el output es vacío (no genera señal útil).
   */
  recordCallResult(toolName: string, output: unknown): LoopCheckResult {
    const fp = reduceOutputForFingerprint(output, this.cfg.fingerprintLength);
    if (!fp) return { abort: false };
    const key = toolName + ':' + sha256(fp);
    const prev = this.outputCounts.get(key) ?? 0;
    const next = prev + 1;
    this.outputCounts.set(key, next);
    if (next >= this.cfg.maxSameOutput) {
      return {
        abort: true,
        verdict: 'LOOP_NO_PROGRESS',
        reason: 'output_repeated',
        hash: key,
      };
    }
    return { abort: false, hash: key };
  }
}

/**
 * Lee la config del detector desde envs (con defaults seguros).
 * El orchestrator la usa para inyectar la config al construir el detector.
 */
export function loopDetectorConfigFromEnv(): LoopDetectorConfig {
  const args = Number(process.env.SHINOBI_LOOP_MAX_REPEAT_ARGS);
  const output = Number(process.env.SHINOBI_LOOP_MAX_SAME_OUTPUT);
  return {
    maxRepeatArgs: Number.isFinite(args) && args > 0 ? args : undefined,
    maxSameOutput: Number.isFinite(output) && output > 0 ? output : undefined,
  };
}
