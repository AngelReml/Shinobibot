// D-017 — gate selectivo de aprobación: modos on/smart/critical/off (default critical).
// Solo frena la clase crítica (credenciales, secreto→.env, ToS, gasto); persiste en config.json.
/**
 * D-017 — Approval system inspired by industry-standard agent permission models.
 *
 * Four modes (ApprovalMode):
 *   - on       : every write/exec tool requires user confirmation. Read-only passes.
 *   - smart    : solo la clase crítica (credenciales, secretos, login, pago, cloud).
 *   - critical : idéntico a 'smart' en implementación actual — alias semántico.
 *   - off      : no checks at all. Path prohibition list bypassed too.
 *
 * Default: 'critical' (lee config.json; si no hay entrada, devuelve 'critical').
 * Config persisted under approval_mode in %APPDATA%\Shinobi\config.json.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { isOutsideWorkspace, approvePathForSession } from '../utils/permissions.js';
import { redactSecrets } from './secret_redactor.js';
import { logApprovalDecision } from '../audit/audit_log.js';

export type ApprovalMode = 'on' | 'smart' | 'critical' | 'off';
export type Approval = 'yes' | 'no' | 'always';
export type Asker = (prompt: string) => Promise<Approval>;

const SHINOBI_DIR = path.join(process.env.APPDATA || os.homedir(), 'Shinobi');
const CONFIG_FILE = path.join(SHINOBI_DIR, 'config.json');

let cachedMode: ApprovalMode | null = null;
const sessionAlwaysApproved = new Set<string>();

function readConfigRaw(): any {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch { /* swallow */ }
  return null;
}

function writeConfigRaw(raw: any): void {
  if (!fs.existsSync(SHINOBI_DIR)) fs.mkdirSync(SHINOBI_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(raw, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

export function getApprovalMode(): ApprovalMode {
  // Precedencia: env > cachedMode (cambio en sesión via setApprovalMode) >
  // config.json persistido > default 'critical'.
  const env = (process.env.SHINOBI_APPROVAL_MODE || '').toLowerCase();
  if (env === 'off' || env === 'critical' || env === 'smart' || env === 'on') return env as ApprovalMode;
  if (cachedMode) return cachedMode;
  // Leer config.json en el primer acceso tras arranque (resultado cacheado en cachedMode).
  const raw = readConfigRaw();
  const persisted = (raw?.approval_mode || '').toLowerCase();
  if (persisted === 'off' || persisted === 'critical' || persisted === 'smart' || persisted === 'on') {
    cachedMode = persisted as ApprovalMode;
    return cachedMode;
  }
  return 'critical';
}

export function setApprovalMode(mode: ApprovalMode): void {
  cachedMode = mode;
  const raw = readConfigRaw() || {};
  raw.approval_mode = mode;
  try { writeConfigRaw(raw); } catch (e: any) {
    console.error('[approval] failed to persist mode:', e?.message ?? e);
  }
}

/**
 * Lee el modo efectivo al arranque. Llama a getApprovalMode() que ya lee
 * config.json si no hay override de env ni cachedMode.
 */
export function ensureApprovalModeInitialized(): { mode: ApprovalMode; created: boolean } {
  return { mode: getApprovalMode(), created: false };
}

/**
 * Patterns matched against run_command's command string.
 */
export const DESTRUCTIVE_PATTERNS: { regex: RegExp; reason: string }[] = [
  { regex: /\brm\s+-rf\b/i, reason: 'recursive force delete (rm -rf)' },
  { regex: /\bdel\s+\/s\b/i, reason: 'recursive delete (del /s)' },
  { regex: /\brmdir\s+\/s\b/i, reason: 'recursive directory removal (rmdir /s)' },
  { regex: /\bRemove-Item\b[^\n]*-Recurse[^\n]*-Force\b/i, reason: 'forced recursive Remove-Item' },
  { regex: /\bRemove-Item\b[^\n]*-Force[^\n]*-Recurse\b/i, reason: 'forced recursive Remove-Item' },
  { regex: /\bformat\b\s+[a-z]:/i, reason: 'disk format' },
  { regex: /\bmkfs\b/i, reason: 'filesystem format (mkfs)' },
  { regex: /\bdd\s+if=/i, reason: 'direct disk dd' },
  { regex: /\bshutdown\b/i, reason: 'system shutdown' },
  { regex: /\breboot\b/i, reason: 'system reboot' },
  { regex: /\btaskkill\b[^\n]*\/f\b/i, reason: 'forced taskkill' },
  { regex: /\bsudo\b/i, reason: 'privilege escalation via sudo' },
  { regex: /\brunas\s+\/user:Administrator\b/i, reason: 'privilege escalation via runas Administrator' },
  { regex: /\bgit\s+push\b[^\n]*--force\b/i, reason: 'git push --force' },
  { regex: /\bgit\s+reset\s+--hard\b/i, reason: 'git reset --hard' },
];

/**
 * Path patterns that mark a write/edit as destructive (modification of
 * critical zones, credentials, .git internals). These are *not* automatic
 * blocks — they trigger an approval request in modes 'on' and 'smart'.
 */
export const CRITICAL_PATH_PATTERNS: { regex: RegExp; reason: string }[] = [
  { regex: /[a-z]:\\Windows\\System32/i, reason: 'modification of Windows\\System32' },
  { regex: /[a-z]:\\Windows(\\|$)/i, reason: 'modification of C:\\Windows' },
  { regex: /[a-z]:\\Program Files/i, reason: 'modification of Program Files' },
  { regex: /\\\.git\\(objects|refs|HEAD)/i, reason: 'modification inside .git internals' },
  { regex: /(^|[\\/])\.env$/i, reason: 'modification of .env credentials file' },
  { regex: /[\\/]\.ssh[\\/]/i, reason: 'modification inside .ssh keys directory' },
  { regex: /\.(pem|key|crt|p12|pfx)$/i, reason: 'modification of credential/cert file' },
  { regex: /^HKEY_LOCAL_MACHINE/i, reason: 'modification of HKEY_LOCAL_MACHINE registry' },
  { regex: /^HKEY_CLASSES_ROOT/i, reason: 'modification of HKEY_CLASSES_ROOT registry' },
];

/**
 * PASO 3 — patrones de COMANDO de la clase crítica: credenciales/login a
 * servicios, pago/gasto, creación de cuenta. NO incluye destrucción genérica de
 * ficheros (rm -rf, format…) — esa es otra preocupación y NO la gatea el freno
 * selectivo (su scope es el compromiso con el mundo real, no el borrado local).
 */
export const CRITICAL_COMMAND_PATTERNS: { regex: RegExp; reason: string }[] = [
  { regex: /\b(aws\s+configure|gcloud\s+auth|az\s+login|gh\s+auth\s+login|npm\s+login|yarn\s+login|vercel\s+login|netlify\s+login|heroku\s+(login|auth)|firebase\s+login|doctl\s+auth|wrangler\s+login)\b/i, reason: 'login / credenciales de un servicio' },
  { regex: /\b(stripe|checkout|billing|invoice|subscribe|subscription|purchase|payment|pay\s+now)\b/i, reason: 'operación de pago / gasto' },
  { regex: /\b(sign[\s_-]?up|register|create[\s_-]?account|new[\s_-]?account)\b/i, reason: 'creación de cuenta' },
  // Borrado MASIVO / recursivo / irreversible. NO el de un fichero concreto
  // (`rm fichero.txt` / `del fichero.txt` siguen libres — sin -r/-f, /s/q ni `*`).
  // Nota: los recursivos/forzados los hard-bloquea además run_command; el comodín
  // `rm *` SÍ pasaba libre y este patrón lo frena (pausa de aprobación).
  { regex: /\brm\s+-[a-z]*[rf]/i, reason: 'borrado recursivo/forzado (rm -r/-f)' },
  { regex: /\brm\s+[^|;&]*\*/i, reason: 'borrado por comodín (rm *)' },
  { regex: /\bdel\s+\/[sqf]/i, reason: 'borrado recursivo/forzado (del /s /q /f)' },
  { regex: /\bdel\s+[^|;&]*\*/i, reason: 'borrado por comodín (del *)' },
  { regex: /\brmdir\s+\/s/i, reason: 'borrado recursivo de directorio (rmdir /s)' },
  { regex: /\b(remove-item|ri)\b[^\n]*-(recurse|force)/i, reason: 'Remove-Item recursivo/forzado' },
  { regex: /\bformat\s+[a-z]:/i, reason: 'formateo de disco (format X:)' },
  { regex: /\bmkfs\b/i, reason: 'formateo de filesystem (mkfs)' },
];

/**
 * PASO 3 — tools que implican COMPROMISO EXTERNO o gasto por su naturaleza
 * (despacho remoto, workflows externos, código remoto, cambios persistentes,
 * proceso externo). Subconjunto crítico de DESTRUCTIVE_TOOLS.
 */
export const CRITICAL_TOOLS = new Set<string>([
  'start_cloud_mission', // despacha swarm remoto → compute/gasto
  'n8n_invoke',          // dispara un workflow externo
  'request_new_skill',   // genera código (potencialmente remoto)
  'task_scheduler_create', // cambio persistente del sistema
  'mcp_connect',         // spawnea un servidor externo (decisión de confianza)
]);

/**
 * Tools that are read-only / observe-only. They never request approval,
 * regardless of mode (matches the "smart" default behavior).
 */
const READ_ONLY_TOOLS = new Set<string>([
  'read_file', 'list_dir', 'search_files',
  'web_search', 'web_search_with_warmup',
  'screen_observe', 'skill_list', 'n8n_list_catalog',
  // browser_observe es read-only; browser_act/browser_session llevan su propio
  // consentimiento (src/browser/consent.ts), no el gate global.
  'browser_observe',
]);

/**
 * Tools considered write/exec in nature. In mode 'on' they always ask.
 * In mode 'smart' they ask only if isDestructive() is true.
 */
export const DESTRUCTIVE_TOOLS = new Set<string>([
  'write_file', 'edit_file', 'run_command',
  // browser_act es la herramienta unificada de browser; no se bloquea a sub-agentes
  // porque Shinobi usa el browser como un humano (autónomo por defecto).
  // Los tools legacy browser_click/browser_scroll/browser_click_position
  // están desregistrados — no los verá ningún agente.
  'screen_act', 'start_cloud_mission', 'n8n_invoke',
  'request_new_skill',
  'task_scheduler_create',
  'mcp_connect',
]);

export interface DestructiveVerdict {
  destructive: boolean;
  reason?: string;
}

/**
 * PASO 3 — clasificador de la CLASE CRÍTICA (la que el freno selectivo pausa):
 * credenciales, escritura de secreto, zona de credenciales (.env/.ssh/.pem…),
 * comandos de login/pago/cuenta, y tools de compromiso externo. Una escritura/
 * edición o comando rutinario (incl. rm -rf, que es destructivo pero NO de esta
 * clase) devuelve { destructive: false }.
 *
 * Pura: no lee el modo. La usa isDestructive cuando el gate está activo.
 */
export function classifyCritical(toolName: string, args: any): DestructiveVerdict {
  if (toolName === 'write_file' || toolName === 'edit_file') {
    const p = typeof args?.path === 'string' ? args.path : '';
    for (const { regex, reason } of CRITICAL_PATH_PATTERNS) {
      if (regex.test(p)) return { destructive: true, reason };
    }
    // Escritura de un SECRETO a cualquier fichero (contenido con forma de clave).
    const content = typeof args?.content === 'string' ? args.content
      : typeof args?.replacement === 'string' ? args.replacement : '';
    if (content && redactSecrets(content).matches.length > 0) {
      return { destructive: true, reason: 'escritura de un secreto/credencial en un fichero' };
    }
    return { destructive: false };
  }
  if (toolName === 'run_command') {
    const cmd = typeof args?.command === 'string' ? args.command : '';
    for (const { regex, reason } of CRITICAL_COMMAND_PATTERNS) {
      if (regex.test(cmd)) return { destructive: true, reason };
    }
    return { destructive: false };
  }
  if (CRITICAL_TOOLS.has(toolName)) {
    return { destructive: true, reason: `compromiso externo / gasto: ${toolName}` };
  }
  return { destructive: false };
}

/**
 * ¿Esta llamada requiere confirmación bajo el modo activo?
 *   - off              → nunca.
 *   - critical / smart → solo la clase crítica (classifyCritical).
 *   - on               → toda tool en DESTRUCTIVE_TOOLS + la clase crítica.
 */
export function isDestructive(toolName: string, args: any): DestructiveVerdict {
  const mode = getApprovalMode();
  if (mode === 'off') return { destructive: false };
  if (mode === 'on' && DESTRUCTIVE_TOOLS.has(toolName)) {
    return { destructive: true, reason: `modo 'on': toda herramienta de escritura/ejecución requiere confirmación` };
  }
  return classifyCritical(toolName, args);
}

export function isReadOnly(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(toolName);
}

// PASO 3 — el asker vuelve a registrarse (la superficie —WebChat/CLI— lo provee).
// requestApproval lo invoca cuando una acción de la clase crítica necesita
// confirmación. Sin asker registrado, una acción crítica se DENIEGA (fail-safe).
let _asker: Asker | null = null;
export function setApprovalAsker(fn: Asker | null): void { _asker = fn; }

/** Pre-gate inyectado por la capa multiuser (modo familia). Se llama ANTES del asker
 *  con la tool y sus args; si devuelve false la acción se deniega sin preguntar. */
let _preGate: ((tool: string, args: any) => Promise<boolean>) | null = null;
export function setApprovalPreGate(fn: ((tool: string, args: any) => Promise<boolean>) | null): void { _preGate = fn; }

export interface ApprovalInput {
  toolName: string;
  args: any;
  destructive?: boolean;
  reason?: string;
}

/**
 * Decide whether a tool call is allowed under the active approval mode.
 * - off   : always true.
 * - smart : ask only if input.destructive (or unknown read-only).
 * - on    : ask for any non-read-only tool.
 *
 * Returns true to proceed, false to abort.
 */
export async function requestApproval(input: ApprovalInput): Promise<boolean> {
  const mode = getApprovalMode();
  if (mode === 'off') return true; // no-op legacy

  // Pre-gate de familia: deniega sin preguntar ciertas tools para usuarios
  // restringidos. Va ANTES de `!input.destructive` a propósito (auditoría
  // 2026-07-01, ALTA-05/MEDIA-06): este check vivía DESPUÉS del early-return
  // de no-destructivo, así que cualquier tool que `classifyCritical`/el modo
  // activo no marcara como crítica (spawn_agent, memory_store, …) nunca
  // llegaba a consultar el gate — `noShell`/`noDestructive` quedaban muertos
  // para esas tools incluso con el pre-gate correctamente instalado. El
  // pre-gate de familia es una caja independiente del freno de aprobación
  // humana; no puede heredar su criterio de "qué es crítico".
  if (_preGate) {
    const allowed = await _preGate(input.toolName, input.args);
    if (!allowed) {
      logApprovalDecision({ tool: input.toolName, decision: 'deny', reason: 'family_gate', mode });
      return false;
    }
  }

  // El freno selectivo SOLO pausa (pide confirmación humana) en la clase
  // crítica. Lo no-crítico procede — el pre-gate de familia, arriba, ya tuvo
  // su oportunidad de denegar independientemente de esta clasificación.
  if (!input.destructive) return true;

  // FIX 0.2: check de ruta crítica ANTES de sessionAlwaysApproved. Si la acción
  // escribe en .env, .ssh, certs, etc., sessionAlwaysApproved NO puede bypassear
  // el gate — siempre se pregunta, aunque el usuario haya dicho "siempre" antes.
  // FIX 0.10: extendido a CRITICAL_TOOLS (start_cloud_mission, n8n_invoke, …).
  // Sin esto, un único "siempre" desbloqueaba despacho de cloud ilimitado en sesión.
  // FIX (auditoría 2026-07-01): extendido a run_command vía classifyCritical en vez
  // de una allowlist de path a mano — la allowlist anterior NUNCA cubría run_command,
  // así que aprobar "siempre" un run_command cualquiera autoaprobaba para siempre
  // CRITICAL_COMMAND_PATTERNS (sudo, git push --force, rm -r/-f…) sin volver a
  // preguntar. classifyCritical() es la única fuente de verdad de qué es crítico;
  // ya no se mantiene una copia parcial aquí.
  const isCriticalPath = classifyCritical(input.toolName, input.args).destructive;

  // "Aprobar siempre" para esta tool en la sesión — excepto rutas/comandos críticos.
  if (!isCriticalPath && sessionAlwaysApproved.has(input.toolName)) {
    logApprovalDecision({ tool: input.toolName, decision: 'allow', reason: input.reason, mode, denySource: undefined });
    return true;
  }

  // Acción crítica sin UI para confirmar → fail-safe: DENIEGA.
  if (!_asker) {
    logApprovalDecision({ tool: input.toolName, decision: 'deny', reason: input.reason, mode, denySource: 'no_asker' });
    return false;
  }

  const reason = input.reason ? ` (${input.reason})` : '';
  const prompt =
    `⚠️ Acción que requiere tu permiso: "${input.toolName}"${reason}.\n` +
    `Args: ${(() => { try { return JSON.stringify(input.args).slice(0, 200); } catch { return '?'; } })()}\n` +
    `¿Apruebas? (sí / no / siempre)`;

  let answer: Approval;
  try {
    answer = await _asker(prompt);
  } catch {
    logApprovalDecision({ tool: input.toolName, decision: 'deny', reason: input.reason, mode, denySource: 'asker_error' });
    return false;
  }

  if (answer === 'always') {
    sessionAlwaysApproved.add(input.toolName);
    logApprovalDecision({ tool: input.toolName, decision: 'allow', reason: input.reason, mode });
    return true;
  }
  const allowed = answer === 'yes';
  logApprovalDecision({ tool: input.toolName, decision: allowed ? 'allow' : 'deny', reason: input.reason, mode, denySource: allowed ? undefined : 'user_no' });
  return allowed;
}

export interface ApprovalRaceResult {
  approved: boolean;
  isTimeout: boolean;
}

/**
 * F2.12 (auditoría 2026-07-01): esta lógica vivía INLINE dentro del bucle
 * de tools de `coordinator/orchestrator.ts` — no exportada, no testeable
 * por separado. El único test que "probaba" el invariante "timeout →
 * deniega" (`security_invariants.test.ts`, bloque "Timeout→DENY") comparaba
 * `(process.env.SHINOBI_APPROVAL_TIMEOUT_ACTION || 'deny')` consigo mismo:
 * tautológico, nunca ejecutaba esta función ni la del orquestador — si la
 * ruta real se invertía, ese test seguía en verde. Extraída aquí, la MISMA
 * función que usa el orquestador es directamente testeable (ver
 * __tests__/approval_timeout_race.test.ts): mockear un asker que nunca
 * resuelve, esperar el timeout real (ms bajos), y asserta sobre el
 * resultado — no sobre una constante releída.
 *
 * `SHINOBI_APPROVAL_TIMEOUT_ACTION`: 'deny' (default, seguro) | 'approve'
 * (⚠ PELIGROSO — auto-aprueba en timeout, equivale a desactivar el gate
 * para sesiones lentas). `SHINOBI_APPROVAL_TIMEOUT_MS` (default 120000).
 */
export async function raceApprovalWithTimeout(input: ApprovalInput): Promise<ApprovalRaceResult> {
  const approvalTimeoutMs = Number(process.env.SHINOBI_APPROVAL_TIMEOUT_MS) || 120_000;
  const timeoutApprove = (process.env.SHINOBI_APPROVAL_TIMEOUT_ACTION || 'deny').toLowerCase() === 'approve';
  if (timeoutApprove && input.destructive) {
    console.warn(`[SECURITY] SHINOBI_APPROVAL_TIMEOUT_ACTION=approve — "${input.toolName}" se auto-aprobará en ${approvalTimeoutMs / 1000}s si no hay respuesta`);
  }

  let isTimeout = false;
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      isTimeout = true;
      resolve(timeoutApprove); // por defecto DENIEGA en timeout
    }, approvalTimeoutMs);
    timer.unref?.(); // no debe mantener el proceso/test vivo si algo más termina antes
  });

  let approved = false;
  try {
    approved = await Promise.race([requestApproval(input), timeoutPromise]);
  } catch {
    // approved queda false — el caller lo trata como denegación.
  } finally {
    if (timer) clearTimeout(timer);
  }
  return { approved, isTimeout };
}

/**
 * Tras una aprobación CONCEDIDA, registra el path objetivo como aprobado
 * manualmente para esta sesión. Así `validatePath` deja pasar la escritura
 * fuera del workspace que el usuario autorizó explícitamente en el chat.
 *
 * Solo aplica a `write_file`/`edit_file` cuyo destino esté fuera del
 * workspace — escrituras dentro del workspace no necesitan registro. El
 * orchestrator lo llama justo después de obtener `approved === true`, antes
 * de ejecutar la tool.
 */
export function registerApprovedPath(toolName: string, args: any): void {
  if (toolName !== 'write_file' && toolName !== 'edit_file') return;
  const p = args?.path;
  if (typeof p !== 'string' || !p.length) return;
  if (isOutsideWorkspace(p)) approvePathForSession(p);
}

export function clearSessionApprovals(): void { sessionAlwaysApproved.clear(); }

export const _internals = { CONFIG_FILE };
