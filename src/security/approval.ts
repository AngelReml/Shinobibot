/**
 * D-017 — Approval system inspired by industry-standard agent permission models.
 *
 * Three modes:
 *   - on      : every write/exec tool requires user confirmation. Read-only passes.
 *   - smart   : only genuinely destructive ops require confirmation. Default.
 *   - off     : no checks at all. Path prohibition list bypassed too.
 *
 * Config persisted under approval_mode in %APPDATA%\Shinobi\config.json.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { isOutsideWorkspace, approvePathForSession } from '../utils/permissions.js';
import { redactSecrets } from './secret_redactor.js';

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
  // PASO 3 — gate SELECTIVO. El no-op global (FIX-002) se reconvierte en un
  // freno que solo pausa en la clase crítica (credenciales, secreto→.env, ToS,
  // creación de cuenta, gasto). Precedencia: env > /approval (cachedMode) >
  // default. Default 'critical' = freno selectivo activo. 'off' sigue disponible
  // para desactivarlo explícitamente.
  const env = (process.env.SHINOBI_APPROVAL_MODE || '').toLowerCase();
  if (env === 'off' || env === 'critical' || env === 'smart' || env === 'on') return env as ApprovalMode;
  if (cachedMode) return cachedMode;
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
 * Ensure the on-disk config has an approval_mode field. Called on startup.
 * If absent, sets default 'smart' and persists it.
 */
export function ensureApprovalModeInitialized(): { mode: ApprovalMode; created: boolean } {
  // PASO 3 — reporta el modo efectivo (gate selectivo activo por defecto).
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
  'browser_click', 'browser_click_position', 'browser_scroll',
  // 'start_cloud_mission' es el nombre REGISTRADO de la tool (cloud_mission.ts);
  // con 'cloud_mission' (nombre del archivo) isDestructive no la encontraba y
  // lanzaba ejecución remota de swarm sin gate. Mismo patrón que request_new_skill.
  'screen_act', 'start_cloud_mission', 'n8n_invoke',
  // El nombre REGISTRADO de la tool es 'request_new_skill' (skill_request_generation.ts:5),
  // no el del archivo. isDestructive() recibe el nombre registrado: con la
  // entrada equivocada la tool se auto-ejecutaba sin gate pese a disparar
  // generación remota de código (gap detectado en el 5º ciclo de auditoría).
  'request_new_skill',
  // task_scheduler_create crea tareas programadas persistentes (schtasks
  // /CREATE /F) — declara requiresConfirmation() pero el gate real corre
  // por esta lista, así que sin esta entrada se auto-ejecutaba sin pedir.
  'task_scheduler_create',
  // mcp_connect spawnea un proceso externo (servidor MCP) y registra sus tools:
  // es una decisión de confianza → requiere gate de aprobación.
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
 *   - off                  → nunca (no-op legacy).
 *   - critical/smart/on    → solo la clase crítica (classifyCritical).
 * El nombre se conserva por compatibilidad con los call sites (orchestrator).
 */
export function isDestructive(toolName: string, args: any): DestructiveVerdict {
  if (getApprovalMode() === 'off') return { destructive: false };
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

  // El freno selectivo SOLO pausa en la clase crítica. Lo no-crítico procede.
  if (!input.destructive) return true;

  // "Aprobar siempre" para esta tool en la sesión.
  if (sessionAlwaysApproved.has(input.toolName)) return true;

  // Acción crítica sin UI para confirmar → fail-safe: DENIEGA (no se crea cuenta
  // / no se gasta / no se escribe credencial de forma desatendida).
  if (!_asker) return false;

  const reason = input.reason ? ` (${input.reason})` : '';
  const prompt =
    `⚠️ Acción que requiere tu permiso: "${input.toolName}"${reason}.\n` +
    `Args: ${(() => { try { return JSON.stringify(input.args).slice(0, 200); } catch { return '?'; } })()}\n` +
    `¿Apruebas? (sí / no / siempre)`;

  let answer: Approval;
  try {
    answer = await _asker(prompt);
  } catch {
    return false; // error al preguntar → fail-safe deny
  }
  if (answer === 'always') { sessionAlwaysApproved.add(input.toolName); return true; }
  return answer === 'yes';
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
