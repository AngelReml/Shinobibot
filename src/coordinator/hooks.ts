/**
 * hooks — ganchos del usuario alrededor de las tools (mejora tomada de Hermes
 * Agent: «hooks»).
 *
 * El dueño de la máquina puede colgar comandos suyos en tres momentos:
 *   - pre_tool:  antes de ejecutar una tool. Si el comando sale con código 2,
 *                la tool NO se ejecuta y lo que escribió en stderr vuelve al
 *                agente como motivo.
 *   - post_tool: después de ejecutarla (para apuntar, avisar, formatear…).
 *   - turn_end:  al terminar cada petición.
 *
 * Se configuran en `hooks.json`, en el directorio de datos de Shinobi (o en
 * la ruta de `SHINOBI_HOOKS_FILE`):
 *
 *   { "hooks": [
 *       { "event": "pre_tool", "tool": "run_command", "command": "python C:/mis/guardian.py" },
 *       { "event": "post_tool", "tool": "write_file|edit_file", "command": "node C:/mis/formatea.js" }
 *   ] }
 *
 * El comando recibe por stdin un JSON con { event, tool, args, result }.
 *
 * DECISIÓN DE SEGURIDAD: el fichero se lee SOLO del directorio de datos del
 * usuario, nunca de la carpeta de trabajo. Un repositorio descargado no puede
 * traer ganchos: eso sería ejecutar comandos de un tercero sin pedir permiso.
 * Un gancho que falla, tarda de más o no existe NO bloquea (solo bloquea el
 * código 2 explícito) y nunca rompe el turno.
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { shinobiDataDir } from '../runtime/data_dir.js';

export type HookEvent = 'pre_tool' | 'post_tool' | 'turn_end';
const EVENTS: readonly HookEvent[] = ['pre_tool', 'post_tool', 'turn_end'];

export interface HookDef {
  event: HookEvent;
  /** Expresión regular sobre el nombre de la tool (anclada). Vacío = todas. */
  tool?: string;
  command: string;
  timeoutMs?: number;
}

export interface HookOutcome { blocked: boolean; reason?: string; ran: number }

export const HOOK_DEFAULT_TIMEOUT_MS = 10_000;
export const HOOK_MAX_TIMEOUT_MS = 60_000;
const HOOK_MAX_PAYLOAD_CHARS = 20_000;
const HOOK_MAX_REASON_CHARS = 1_000;

let _cache: { file: string; mtimeMs: number; hooks: HookDef[] } | null = null;

export function hooksFile(): string {
  return process.env.SHINOBI_HOOKS_FILE || path.join(shinobiDataDir(), 'hooks.json');
}

/** Valida la configuración. Las entradas mal formadas se descartan (con aviso), no rompen. */
export function parseHooks(raw: unknown): HookDef[] {
  const list = Array.isArray((raw as any)?.hooks) ? (raw as any).hooks : [];
  const out: HookDef[] = [];
  for (const h of list) {
    const event = String(h?.event ?? '') as HookEvent;
    const command = String(h?.command ?? '').trim();
    if (!EVENTS.includes(event) || !command) continue;
    let tool: string | undefined;
    if (h?.tool !== undefined && String(h.tool).trim()) {
      tool = String(h.tool).trim();
      try { new RegExp(`^(?:${tool})$`); } catch { continue; }
    }
    const t = Number(h?.timeoutMs);
    out.push({ event, tool, command, timeoutMs: Number.isFinite(t) && t > 0 ? Math.min(t, HOOK_MAX_TIMEOUT_MS) : undefined });
  }
  return out;
}

export function loadHooks(): HookDef[] {
  if (process.env.SHINOBI_HOOKS === '0') return [];
  const file = hooksFile();
  try {
    const st = fs.statSync(file);
    if (_cache && _cache.file === file && _cache.mtimeMs === st.mtimeMs) return _cache.hooks;
    const hooks = parseHooks(JSON.parse(fs.readFileSync(file, 'utf-8')));
    _cache = { file, mtimeMs: st.mtimeMs, hooks };
    return hooks;
  } catch {
    return [];
  }
}

export function hooksFor(event: HookEvent, tool?: string, hooks: HookDef[] = loadHooks()): HookDef[] {
  return hooks.filter(h => h.event === event && (!h.tool || (tool !== undefined && new RegExp(`^(?:${h.tool})$`).test(tool))));
}

function runOne(h: HookDef, payload: string): Promise<{ code: number | null; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let done = false;
    let stderr = '';
    const finish = (code: number | null, timedOut = false) => { if (!done) { done = true; clearTimeout(timer); resolve({ code, stderr, timedOut }); } };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(h.command, { shell: true, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    } catch { return resolve({ code: null, stderr: '', timedOut: false }); }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ya muerto */ } finish(null, true); }, h.timeoutMs ?? HOOK_DEFAULT_TIMEOUT_MS);
    child.stderr?.on('data', (d) => { if (stderr.length < HOOK_MAX_REASON_CHARS * 2) stderr += String(d); });
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code));
    child.stdin?.on('error', () => { /* el gancho no leyó stdin: no importa */ });
    try { child.stdin?.end(payload); } catch { /* idem */ }
  });
}

/**
 * Ejecuta los ganchos de un evento, en orden. Para `pre_tool`, el primero que
 * salga con código 2 bloquea y se dejan de ejecutar los siguientes.
 */
export async function runHooks(event: HookEvent, data: { tool?: string; args?: any; result?: any; input?: string }): Promise<HookOutcome> {
  const hooks = hooksFor(event, data.tool);
  if (hooks.length === 0) return { blocked: false, ran: 0 };
  let payload: string;
  try { payload = JSON.stringify({ event, ...data }).slice(0, HOOK_MAX_PAYLOAD_CHARS); } catch { payload = JSON.stringify({ event, tool: data.tool }); }
  let ran = 0;
  for (const h of hooks) {
    const r = await runOne(h, payload);
    ran++;
    if (r.timedOut) { console.log(`  [🪝] gancho ${event} agotó el tiempo y se ignora: ${h.command.slice(0, 80)}`); continue; }
    if (event === 'pre_tool' && r.code === 2) {
      const reason = r.stderr.trim().slice(0, HOOK_MAX_REASON_CHARS) || 'bloqueado por un gancho del usuario';
      return { blocked: true, reason, ran };
    }
  }
  return { blocked: false, ran };
}

export function describeHooks(): string {
  const hooks = loadHooks();
  if (process.env.SHINOBI_HOOKS === '0') return 'Ganchos apagados (SHINOBI_HOOKS=0).';
  if (hooks.length === 0) return `No hay ganchos. Se definen en ${hooksFile()}`;
  const lines = hooks.map(h => `  ${h.event}${h.tool ? ` [${h.tool}]` : ''} → ${h.command}`);
  return `Ganchos activos (${hooksFile()}):\n${lines.join('\n')}`;
}

export function _resetHooksCacheForTests(): void { _cache = null; }
