/**
 * Loop Detector — tres capas:
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
 *   3) Capa de modo de fallo (v3 — incidente 2026-05-16):
 *      Clasifica cada fallo en un "modo de fallo de ENTORNO" estable
 *      (browser caído, API key inválida, fichero inexistente, red). El
 *      K-ésimo fallo consecutivo del MISMO modo (default K=3) aborta con
 *      `LOOP_SAME_FAILURE` — aunque sean tools distintas con args distintos.
 *      Captura el caso que la capa 2 NO ve: el agente prueba 12 keywords con
 *      clean_extract, cada output menciona la keyword (fingerprints distintos)
 *      pero la CAUSA de fondo es la misma ("No browser on port 9222"). Cuando
 *      el bloqueo es del entorno, cambiar de táctica no progresa: hay que
 *      parar y pedir intervención humana.
 *
 * Diferencia clave vs Hermes (no tiene loop detector) y OpenClaw (sin
 * detector explícito): aquí hay TRES señales independientes — incluso si
 * el agente intenta esquivar una, las otras lo cazan.
 *
 * Diseño:
 *   - El detector mantiene estado por sesión (un LoopDetector por
 *     executeToolLoop).
 *   - `recordCallAttempt` se llama ANTES de ejecutar la tool. Si la capa de
 *     args detecta repetición, devuelve `{ abort: true, verdict: 'LOOP_DETECTED' }`.
 *   - `recordCallResult` se llama DESPUÉS de ejecutar la tool. Si la capa
 *     semántica detecta no-progress, devuelve `{ abort: true,
 *     verdict: 'LOOP_NO_PROGRESS' }`.
 *   - `recordOutcome` se llama DESPUÉS de ejecutar la tool, con su éxito/error.
 *     Si la capa de modo de fallo detecta bloqueo de entorno repetido,
 *     devuelve `{ abort: true, verdict: 'LOOP_SAME_FAILURE' }`.
 *   - Todos los métodos devuelven `{ abort: false }` cuando no hay problema.
 */

import { createHash } from 'crypto';

export type LoopVerdict = 'LOOP_DETECTED' | 'LOOP_NO_PROGRESS' | 'LOOP_SAME_FAILURE';

/** Modos de fallo de entorno que `classifyFailureMode` reconoce. */
export type FailureMode =
  | 'browser_unavailable'
  | 'auth_invalid'
  | 'file_not_found'
  | 'network_unreachable';

/**
 * Clasifica un mensaje de error en un "modo de fallo de ENTORNO" estable, o
 * `null` si el error no parece de entorno (probable bug del agente, que SÍ se
 * puede arreglar cambiando de táctica — no debe contar para la capa 3).
 *
 * Exportada para que los tests la ejerciten.
 */
export function classifyFailureMode(error: unknown): FailureMode | null {
  if (error == null) return null;
  const e = String(error).toLowerCase();
  if (!e.trim()) return null;
  // Browser / CDP caído — el caso del incidente Iván (clean_extract sin Comet).
  if (/no browser|port\s*9222|\bcdp\b|devtools|chrome[^.]*not[^.]*(found|running|available)|comet[^.]*(not|no)[^.]*(open|running)|browserless|puppeteer.*(connect|launch)/.test(e)) {
    return 'browser_unavailable';
  }
  // API key / autenticación.
  if (/api[\s_-]?key|unauthorized|authentication failed|invalid.*(credential|token|key)|\b401\b|\b403\b|missing.*api/.test(e)) {
    return 'auth_invalid';
  }
  // Fichero / ruta inexistente.
  if (/\benoent\b|no such file|file not found|cannot find the (file|path)|path does not exist|does not exist/.test(e)) {
    return 'file_not_found';
  }
  // Red inalcanzable.
  if (/\beconnrefused\b|\betimedout\b|\benotfound\b|\beai_again\b|network error|getaddrinfo|socket hang up|dns/.test(e)) {
    return 'network_unreachable';
  }
  return null;
}

/** Texto orientativo para el usuario según el modo de fallo de entorno. */
export function failureModeAdvice(mode: string): string {
  switch (mode) {
    case 'browser_unavailable':
      return 'el navegador no está disponible (Comet/Chrome sin puerto de depuración CDP). Abre Comet y reintenta.';
    case 'auth_invalid':
      return 'una credencial / API key es inválida o falta. Revisa la configuración y reintenta.';
    case 'file_not_found':
      return 'un fichero o ruta necesarios no existen. Verifica la ruta y reintenta.';
    case 'network_unreachable':
      return 'la red no es alcanzable. Comprueba la conexión y reintenta.';
    default:
      return 'el entorno está bloqueado. Resuelve la causa y reintenta.';
  }
}

export interface LoopDetectorConfig {
  /** Repeticiones del mismo hash de args que disparan abort (default 2). */
  maxRepeatArgs?: number;
  /**
   * Outputs indistinguibles (mismo fingerprint reducido para la misma tool)
   * que disparan abort (default 3).
   */
  maxSameOutput?: number;
  /**
   * Fallos consecutivos del mismo modo de fallo de entorno (browser caído,
   * API key inválida, etc.) que disparan abort (default 3). Capa 3.
   */
  maxSameFailureMode?: number;
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
  maxSameFailureMode: 3,
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
  /** Capa 3: modo de fallo de entorno de la racha actual (null = sin racha). */
  private currentFailureMode: FailureMode | null = null;
  /** Capa 3: nº de fallos consecutivos del modo `currentFailureMode`. */
  private currentFailureRun = 0;

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

  /**
   * Capa 3 (modo de fallo). Llamar después de ejecutar la tool, con su
   * éxito/error. Detecta K fallos consecutivos que comparten el mismo modo de
   * fallo de ENTORNO (browser caído, API key inválida, fichero inexistente,
   * red) — aunque sean tools distintas con args distintos. En ese caso el
   * agente no puede progresar cambiando de táctica: debe parar y pedir
   * intervención humana en lugar de, p.ej., cerrar ventanas con Alt+F4.
   *
   * La racha se rompe (contador a 0) ante un éxito, o ante un fallo que no se
   * clasifica como de entorno (probable bug del agente). Un fallo de un modo
   * de entorno distinto reinicia la racha a ese modo nuevo.
   */
  recordOutcome(toolName: string, success: boolean, error?: unknown): LoopCheckResult {
    if (success) {
      this.currentFailureMode = null;
      this.currentFailureRun = 0;
      return { abort: false };
    }
    const mode = classifyFailureMode(error);
    if (!mode) {
      // Fallo no clasificable como entorno — no cuenta para la capa 3 y
      // rompe cualquier racha previa (la situación cambió).
      this.currentFailureMode = null;
      this.currentFailureRun = 0;
      return { abort: false };
    }
    if (mode === this.currentFailureMode) {
      this.currentFailureRun += 1;
    } else {
      this.currentFailureMode = mode;
      this.currentFailureRun = 1;
    }
    if (this.currentFailureRun >= this.cfg.maxSameFailureMode) {
      return {
        abort: true,
        verdict: 'LOOP_SAME_FAILURE',
        reason: `env_failure:${mode}`,
      };
    }
    return { abort: false };
  }
}

/**
 * Lee la config del detector desde envs (con defaults seguros).
 * El orchestrator la usa para inyectar la config al construir el detector.
 */
export function loopDetectorConfigFromEnv(): LoopDetectorConfig {
  const args = Number(process.env.SHINOBI_LOOP_MAX_REPEAT_ARGS);
  const output = Number(process.env.SHINOBI_LOOP_MAX_SAME_OUTPUT);
  const failMode = Number(process.env.SHINOBI_LOOP_MAX_SAME_FAILURE);
  return {
    maxRepeatArgs: Number.isFinite(args) && args > 0 ? args : undefined,
    maxSameOutput: Number.isFinite(output) && output > 0 ? output : undefined,
    maxSameFailureMode: Number.isFinite(failMode) && failMode > 0 ? failMode : undefined,
  };
}
