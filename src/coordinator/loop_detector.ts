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
 *   3) Capa de modo de fallo (v3 — incidente 2026-05-16, revisada):
 *      Clasifica cada fallo en un "modo de fallo de ENTORNO" estable
 *      (browser caído, API key inválida, fichero inexistente, red) y aborta
 *      con `LOOP_SAME_FAILURE` — aunque sean tools distintas con args
 *      distintos. Captura el caso que la capa 2 NO ve: el agente prueba 12
 *      keywords con clean_extract, cada output menciona la keyword
 *      (fingerprints distintos) pero la CAUSA de fondo es la misma ("No
 *      browser on port 9222"). Cuando el bloqueo es del entorno, cambiar de
 *      táctica no progresa: hay que parar y pedir intervención humana.
 *
 *      IMPORTANTE — el primer diseño (fallos CONSECUTIVOS) falló en prueba
 *      real: Shinobi intercaló otras tools (taskkill, sleeps, screen_observe)
 *      entre los fallos de browser, reseteando el contador, y llegó a la
 *      iteración 10 sin abortar (fallos en iter 4, 5, 8 — no consecutivos).
 *      La capa 3 NO cuenta consecutivos. Usa DOS señales que ignoran lo que
 *      pase entre medias:
 *        a) Contador ACUMULATIVO por modo: total de veces que el modo X
 *           ocurre en TODA la misión. Nunca se resetea. Si llega a
 *           `maxSameFailureMode` (default 3) → abort. Es el backstop duro.
 *        b) Ventana DESLIZANTE: ≥ `failureWindowThreshold` (default 3) fallos
 *           del mismo modo dentro de las últimas `failureWindowSize`
 *           (default 6) llamadas → abort. Caza el "clustering" cuando el
 *           umbral acumulativo se ha subido mucho a propósito.
 *      Aborta la que dispare primero.
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
   * Capa 3 — contador ACUMULATIVO: nº total de fallos del mismo modo de
   * entorno en toda la misión que disparan abort (default 3). NO se resetea
   * con éxitos ni con otras tools intercaladas.
   */
  maxSameFailureMode?: number;
  /**
   * Capa 3 — tamaño de la ventana deslizante (nº de llamadas a `recordOutcome`
   * recientes que se inspeccionan, default 6).
   */
  failureWindowSize?: number;
  /**
   * Capa 3 — fallos del mismo modo dentro de la ventana deslizante que
   * disparan abort (default 3).
   */
  failureWindowThreshold?: number;
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
  failureWindowSize: 6,
  failureWindowThreshold: 3,
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
  /** Capa 3: contador acumulativo por modo de fallo (NUNCA se resetea). */
  private readonly failureModeTotals = new Map<FailureMode, number>();
  /**
   * Capa 3: ventana deslizante de los últimos resultados. Cada entrada es el
   * modo de fallo de entorno de esa llamada, o `null` (éxito / fallo no de
   * entorno). Se mantiene acotada a `failureWindowSize`.
   */
  private readonly outcomeWindow: (FailureMode | null)[] = [];

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
   * Capa 3 (modo de fallo). Llamar después de ejecutar CADA tool, con su
   * éxito/error. Detecta bloqueo de ENTORNO repetido (browser caído, API key
   * inválida, fichero inexistente, red) — aunque sean tools distintas con args
   * distintos Y aunque haya éxitos u otras tools intercalados entre los fallos.
   *
   * NO cuenta fallos consecutivos (ese diseño falló en prueba real: el agente
   * intercala taskkill/sleeps/screen_observe entre fallos de browser). Usa dos
   * señales independientes, aborta la primera que dispare:
   *   a) Contador ACUMULATIVO por modo — total en toda la misión, nunca se
   *      resetea. ≥ `maxSameFailureMode` → abort.
   *   b) Ventana DESLIZANTE — ≥ `failureWindowThreshold` fallos del mismo modo
   *      en las últimas `failureWindowSize` llamadas → abort.
   *
   * Éxitos y fallos no-de-entorno ocupan un hueco en la ventana pero NO
   * incrementan ningún contador (no rompen la detección, solo desplazan).
   */
  recordOutcome(toolName: string, success: boolean, error?: unknown): LoopCheckResult {
    const mode: FailureMode | null = success ? null : classifyFailureMode(error);

    // Toda llamada ocupa un hueco en la ventana deslizante (éxito o fallo).
    this.outcomeWindow.push(mode);
    if (this.outcomeWindow.length > this.cfg.failureWindowSize) {
      this.outcomeWindow.shift();
    }

    // Éxito o fallo no clasificable como entorno: no incrementa contadores.
    // (Un bug del agente SÍ se arregla cambiando de táctica — no es capa 3.)
    if (!mode) return { abort: false };

    // a) Contador acumulativo — backstop duro, ignora todo lo intercalado.
    const total = (this.failureModeTotals.get(mode) ?? 0) + 1;
    this.failureModeTotals.set(mode, total);
    if (total >= this.cfg.maxSameFailureMode) {
      return {
        abort: true,
        verdict: 'LOOP_SAME_FAILURE',
        reason: `env_failure:${mode}`,
        hash: `cumulative:${total}`,
      };
    }

    // b) Ventana deslizante — clustering reciente del mismo modo.
    const inWindow = this.outcomeWindow.reduce((n, m) => (m === mode ? n + 1 : n), 0);
    if (inWindow >= this.cfg.failureWindowThreshold) {
      return {
        abort: true,
        verdict: 'LOOP_SAME_FAILURE',
        reason: `env_failure:${mode}`,
        hash: `window:${inWindow}/${this.outcomeWindow.length}`,
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
  const winSize = Number(process.env.SHINOBI_LOOP_FAILURE_WINDOW_SIZE);
  const winThreshold = Number(process.env.SHINOBI_LOOP_FAILURE_WINDOW_THRESHOLD);
  return {
    maxRepeatArgs: Number.isFinite(args) && args > 0 ? args : undefined,
    maxSameOutput: Number.isFinite(output) && output > 0 ? output : undefined,
    maxSameFailureMode: Number.isFinite(failMode) && failMode > 0 ? failMode : undefined,
    failureWindowSize: Number.isFinite(winSize) && winSize > 0 ? winSize : undefined,
    failureWindowThreshold: Number.isFinite(winThreshold) && winThreshold > 0 ? winThreshold : undefined,
  };
}
