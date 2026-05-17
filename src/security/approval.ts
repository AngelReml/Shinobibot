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
  if (cachedMode) return cachedMode;
  const raw = readConfigRaw();
  if (raw && (raw.approval_mode === 'on' || raw.approval_mode === 'smart' || raw.approval_mode === 'off')) {
    cachedMode = raw.approval_mode;
    return cachedMode!;
  }
  cachedMode = 'smart';
  return 'smart';
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
  const raw = readConfigRaw();
  if (raw && (raw.approval_mode === 'on' || raw.approval_mode === 'smart' || raw.approval_mode === 'off')) {
    cachedMode = raw.approval_mode;
    return { mode: raw.approval_mode, created: false };
  }
  const next = raw || {};
  next.approval_mode = 'smart';
  cachedMode = 'smart';
  try { writeConfigRaw(next); } catch { /* if config doesn't exist yet, the wizard will create it */ }
  return { mode: 'smart', created: true };
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
]);

/**
 * Tools considered write/exec in nature. In mode 'on' they always ask.
 * In mode 'smart' they ask only if isDestructive() is true.
 */
export const DESTRUCTIVE_TOOLS = new Set<string>([
  'write_file', 'edit_file', 'run_command',
  'browser_click', 'browser_click_position', 'browser_scroll',
  'screen_act', 'cloud_mission', 'n8n_invoke',
  // El nombre REGISTRADO de la tool es 'request_new_skill' (skill_request_generation.ts:5),
  // no el del archivo. isDestructive() recibe el nombre registrado: con la
  // entrada equivocada la tool se auto-ejecutaba sin gate pese a disparar
  // generación remota de código (gap detectado en el 5º ciclo de auditoría).
  'request_new_skill',
  // task_scheduler_create crea tareas programadas persistentes (schtasks
  // /CREATE /F) — declara requiresConfirmation() pero el gate real corre
  // por esta lista, así que sin esta entrada se auto-ejecutaba sin pedir.
  'task_scheduler_create',
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
  if (READ_ONLY_TOOLS.has(toolName)) return { destructive: false };

  if (toolName === 'run_command' && typeof args?.command === 'string') {
    for (const p of DESTRUCTIVE_PATTERNS) {
      if (p.regex.test(args.command)) return { destructive: true, reason: p.reason };
    }
    return { destructive: false };
  }

  if (toolName === 'write_file' || toolName === 'edit_file') {
    const target = typeof args?.path === 'string' ? path.resolve(args.path) : '';
    for (const p of CRITICAL_PATH_PATTERNS) {
      if (p.regex.test(target)) return { destructive: true, reason: p.reason };
    }
    return { destructive: false };
  }

  // Resto de tools de la lista destructiva (screen_act, browser_click,
  // cloud_mission, n8n_invoke, task_scheduler_create…): siempre requieren
  // confirmación. Antes `isDestructive` no consultaba DESTRUCTIVE_TOOLS —
  // la lista era código muerto y esas tools se auto-ejecutaban sin gate.
  if (DESTRUCTIVE_TOOLS.has(toolName)) {
    return { destructive: true, reason: `tool potencialmente destructiva: ${toolName}` };
  }

  return { destructive: false };
}

export function isReadOnly(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(toolName);
}

let activeAsker: Asker = async () => 'no'; // safe default in non-interactive contexts

export function setApprovalAsker(fn: Asker): void { activeAsker = fn; }

function approvalCacheKey(toolName: string, args: any): string {
  let argSig: string;
  try { argSig = JSON.stringify(args); } catch { argSig = String(args); }
  return `${toolName}::${argSig}`;
}

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
  if (mode === 'off') return true;
  if (isReadOnly(input.toolName)) return true;

  const cacheKey = approvalCacheKey(input.toolName, input.args);
  if (sessionAlwaysApproved.has(cacheKey)) return true;

  if (mode === 'smart' && !input.destructive) return true;

  const reason = input.destructive
    ? (input.reason || 'classified as destructive')
    : 'approval mode = on (every write/exec requires confirmation)';

  let argsPreview: string;
  try {
    const s = JSON.stringify(input.args);
    argsPreview = s.length > 240 ? s.slice(0, 240) + '…' : s;
  } catch {
    argsPreview = String(input.args);
  }

  const promptText =
    `\n⚠️  Shinobi quiere ejecutar: ${input.toolName} con args: ${argsPreview}\n` +
    `Esta operación se considera destructiva porque: ${reason}\n` +
    `¿Permitir? [y]es / [n]o / [a]lways for this session: `;

  const answer = await activeAsker(promptText);
  if (answer === 'always') {
    sessionAlwaysApproved.add(cacheKey);
    return true;
  }
  return answer === 'yes';
}

export function clearSessionApprovals(): void { sessionAlwaysApproved.clear(); }

export const _internals = { CONFIG_FILE };
