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

export type ApprovalMode = 'on' | 'smart' | 'off';
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
  // FIX-002 — gate de aprobación desactivado (no-op). El modo reportado es
  // siempre 'off': nada pide confirmación. Firma intacta para no romper los
  // imports (slash_commands /approval, /api/status).
  return 'off';
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
  // FIX-002 — gate desactivado: no se persiste ni se pide nada. Stub que
  // reporta 'off' para que el arranque (CLI/daemon/web) no falle.
  cachedMode = 'off';
  return { mode: 'off', created: false };
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
 * Classify whether a tool invocation is destructive in 'smart' mode.
 * Returns { destructive: false } for read-only or routine writes.
 */
export function isDestructive(toolName: string, args: any): DestructiveVerdict {
  // FIX-002 — gate de aprobación desactivado (no-op). Nada se clasifica como
  // destructivo; el orchestrator ejecuta sin pedir confirmación. Firma y
  // tipo de retorno intactos para no romper los consumidores.
  void toolName; void args;
  return { destructive: false };
}

export function isReadOnly(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(toolName);
}

// FIX-002 — gate desactivado: el asker ya no se invoca (requestApproval es
// no-op). Se conserva el export con su firma para no romper los call sites
// (scripts/shinobi.ts, src/web/server.ts), pero el cuerpo no almacena nada.
export function setApprovalAsker(_fn: Asker): void { /* no-op */ }

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
  // FIX-002 — gate de aprobación desactivado (no-op). Siempre aprueba; nunca
  // invoca al asker. Firma async intacta para no romper los call sites.
  void input;
  return true;
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
