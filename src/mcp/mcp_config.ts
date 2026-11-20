// src/mcp/mcp_config.ts
//
// Servidores MCP GUARDADOS: `mcp.json` en la carpeta de datos del usuario. Así
// un servidor (REA, p. ej.) se conecta solo al abrir Shinobi, sin que el modelo
// tenga que llamar a `mcp_connect` ni el usuario repetir el comando.
//
// El fichero se lee SOLO de la carpeta de datos del usuario (o de
// SHINOBI_MCP_FILE), nunca del workspace: un repo clonado no puede traer un
// mcp.json que arranque procesos en tu máquina. Acepta la clave `servers` y
// también `mcpServers` (el formato que usan Claude Code y otros clientes).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { shinobiDataDir } from '../runtime/data_dir.js';
import { registerMcpServer, connectedMcpServers } from './mcp_registry.js';
import type { McpClient } from './types.js';
import type { StdioMcpConfig } from './stdio_client.js';

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** true = guardado pero no se conecta al arrancar. */
  disabled?: boolean;
  timeoutMs?: number;
}

export type McpConfig = Record<string, McpServerConfig>;

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/;

/**
 * Atajos para servidores conocidos: `/mcp add rea` sin más. La versión va
 * FIJADA (no @latest): es código de un tercero que se ejecuta en tu máquina,
 * y se sube de versión a propósito, no sola.
 */
export const MCP_PRESETS: Record<string, McpServerConfig> = {
  rea: { command: 'npx', args: ['-y', 'rea-agents@6.10.1', 'mcp'] },
};

export function mcpConfigFile(): string {
  return process.env.SHINOBI_MCP_FILE || path.join(shinobiDataDir(), 'mcp.json');
}

/** ¿Está activa la autoconexión? Off con SHINOBI_MCP=0, y en tests salvo fichero explícito. */
export function mcpAutoConnectEnabled(): boolean {
  if (process.env.SHINOBI_MCP === '0') return false;
  if (process.env.VITEST && !process.env.SHINOBI_MCP_FILE) return false;
  return true;
}

export function isValidServerName(name: string): boolean {
  return NAME_RE.test(name);
}

function cleanStrings(v: any): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x) => typeof x === 'string');
  return out.length ? out : undefined;
}

function cleanEnv(v: any): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean')) out[k] = String(val);
  }
  return Object.keys(out).length ? out : undefined;
}

/** Valida y normaliza el contenido de mcp.json. Las entradas mal formadas se descartan con aviso. */
export function parseMcpConfig(raw: any): { servers: McpConfig; problems: string[] } {
  const servers: McpConfig = {};
  const problems: string[] = [];
  const src = raw && typeof raw === 'object' ? (raw.servers ?? raw.mcpServers) : undefined;
  if (!src || typeof src !== 'object' || Array.isArray(src)) return { servers, problems };
  for (const [name, v] of Object.entries(src as Record<string, any>)) {
    if (!isValidServerName(name)) { problems.push(`nombre no válido: "${name}"`); continue; }
    if (!v || typeof v !== 'object' || typeof v.command !== 'string' || !v.command.trim()) {
      problems.push(`"${name}": falta "command"`); continue;
    }
    const cfg: McpServerConfig = { command: v.command.trim() };
    const args = cleanStrings(v.args); if (args) cfg.args = args;
    const env = cleanEnv(v.env); if (env) cfg.env = env;
    if (typeof v.cwd === 'string' && v.cwd.trim()) cfg.cwd = v.cwd.trim();
    if (v.disabled === true) cfg.disabled = true;
    if (Number.isFinite(v.timeoutMs) && v.timeoutMs >= 1000) cfg.timeoutMs = Number(v.timeoutMs);
    servers[name] = cfg;
  }
  return { servers, problems };
}

export function loadMcpConfig(): { servers: McpConfig; problems: string[] } {
  const file = mcpConfigFile();
  try {
    if (!fs.existsSync(file)) return { servers: {}, problems: [] };
    return parseMcpConfig(JSON.parse(fs.readFileSync(file, 'utf-8')));
  } catch (e: any) {
    return { servers: {}, problems: [`mcp.json ilegible: ${e?.message ?? e}`] };
  }
}

function writeMcpConfig(servers: McpConfig): void {
  const file = mcpConfigFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ servers }, null, 2) + '\n', 'utf-8');
}

export function saveMcpServer(name: string, cfg: McpServerConfig): void {
  if (!isValidServerName(name)) throw new Error(`Nombre de servidor no válido: "${name}" (letras, números, - y _).`);
  const { servers } = loadMcpConfig();
  const { servers: one, problems } = parseMcpConfig({ servers: { [name]: cfg } });
  if (!one[name]) throw new Error(problems[0] ?? 'configuración no válida');
  servers[name] = one[name];
  writeMcpConfig(servers);
}

export function removeMcpServer(name: string): boolean {
  const { servers } = loadMcpConfig();
  if (!(name in servers)) return false;
  delete servers[name];
  writeMcpConfig(servers);
  return true;
}

/** Parámetros de arranque de un servidor guardado. cwd por defecto: la carpeta de datos (nunca el proyecto abierto). */
export function toStdioConfig(name: string, cfg: McpServerConfig): StdioMcpConfig {
  return {
    name,
    command: cfg.command,
    args: cfg.args,
    env: cfg.env,
    cwd: cfg.cwd || shinobiDataDir(),
    timeoutMs: cfg.timeoutMs,
  };
}

export interface McpConnectOutcome { name: string; ok: boolean; tools: number; error?: string }

type Factory = (cfg: StdioMcpConfig) => Promise<McpClient>;

/** Conecta un servidor guardado y registra sus tools (van al cajón). Nunca lanza. */
export async function connectSavedServer(name: string, cfg: McpServerConfig, factory: Factory, connectTimeoutMs = 60_000): Promise<McpConnectOutcome> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const client = await Promise.race([
      factory(toStdioConfig(name, cfg)),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`no respondió en ${Math.round(connectTimeoutMs / 1000)} s`)), connectTimeoutMs); }),
    ]);
    const { registered } = await registerMcpServer(name, client);
    return { name, ok: true, tools: registered.length };
  } catch (e: any) {
    return { name, ok: false, tools: 0, error: String(e?.message ?? e).slice(0, 600) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let _auto: Promise<McpConnectOutcome[]> | null = null;

/**
 * Conecta, UNA vez por proceso, los servidores guardados y no deshabilitados.
 * Un servidor que falla no impide arrancar: se avisa y se sigue.
 */
export function ensureMcpAutoConnected(factory: Factory): Promise<McpConnectOutcome[]> {
  if (_auto) return _auto;
  _auto = (async () => {
    if (!mcpAutoConnectEnabled()) return [];
    const { servers, problems } = loadMcpConfig();
    for (const p of problems) console.log(`[mcp] aviso: ${p}`);
    const todo = Object.entries(servers).filter(([n, c]) => !c.disabled && !connectedMcpServers().includes(n));
    const out = await Promise.all(todo.map(([n, c]) => connectSavedServer(n, c, factory)));
    for (const r of out) {
      console.log(r.ok
        ? `[mcp] ${r.name}: conectado, ${r.tools} herramientas en el cajón`
        : `[mcp] ${r.name}: no se pudo conectar — ${r.error}`);
    }
    return out;
  })();
  return _auto;
}

/** Solo para tests: permite volver a ejecutar la autoconexión. */
export function _resetMcpAutoConnect(): void { _auto = null; }
