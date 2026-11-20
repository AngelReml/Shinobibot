// src/mcp/mcp_command.ts
//
// Comando `/mcp`: gestiona los servidores MCP guardados (mcp.json). Lo escribe
// el USUARIO, así que añadir y conectar un servidor aquí es su decisión
// explícita (el modelo, en cambio, pasa por el candado con `mcp_connect`).

import {
  loadMcpConfig, saveMcpServer, removeMcpServer, connectSavedServer, mcpConfigFile,
  isValidServerName, MCP_PRESETS, type McpServerConfig,
} from './mcp_config.js';
import { disconnectMcpServer, mcpServerSummaries } from './mcp_registry.js';
import { mcpClientFactory } from '../tools/mcp_connect.js';
import { isMcpEager } from '../tools/tool_activation.js';

/** Parte una línea en palabras respetando comillas dobles y simples (rutas de Windows con espacios). */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function show(name: string, c: McpServerConfig): string {
  const cmd = [c.command, ...(c.args ?? [])].join(' ');
  const env = c.env ? ` · env: ${Object.keys(c.env).join(', ')}` : '';
  return `${name}: ${cmd}${env}${c.disabled ? ' · (deshabilitado)' : ''}`;
}

export function describeMcp(): string {
  const { servers, problems } = loadMcpConfig();
  const live = new Map(mcpServerSummaries().map((s) => [s.name, s]));
  const names = [...new Set([...Object.keys(servers), ...live.keys()])].sort();
  const out: string[] = [];
  if (names.length === 0) {
    out.push('No hay servidores MCP guardados.');
  } else {
    out.push('Servidores MCP:');
    for (const n of names) {
      const s = live.get(n);
      const state = s ? `conectado · ${s.total} herramientas, ${s.active} a mano` : 'sin conectar';
      out.push(`  ${servers[n] ? show(n, servers[n]) : `${n}: (conectado en esta sesión, no guardado)`}\n    → ${state}`);
    }
    out.push(isMcpEager()
      ? '  Modo SHINOBI_MCP_EAGER=1: todas las herramientas MCP se anuncian en cada turno (caro).'
      : '  Las herramientas MCP van al cajón: el agente saca las que necesita con tool_search.');
  }
  for (const p of problems) out.push(`  aviso: ${p}`);
  out.push(`Fichero: ${mcpConfigFile()}`);
  out.push(`Uso: /mcp add <nombre> [comando args…] · remove <nombre> · connect <nombre> · disconnect <nombre> · env <nombre> CLAVE=valor`);
  out.push(`Atajos conocidos para /mcp add: ${Object.keys(MCP_PRESETS).join(', ')}`);
  return out.join('\n');
}

export async function handleMcpCommand(argLine: string): Promise<string> {
  const [sub, name, ...rest] = splitArgs(argLine);
  if (!sub || sub === 'list' || sub === 'estado') return describeMcp();

  if (sub === 'add') {
    if (!name || !isValidServerName(name)) return 'Uso: /mcp add <nombre> [comando args…]  (nombre: letras, números, - y _)';
    const cfg: McpServerConfig | undefined = rest.length
      ? { command: rest[0], args: rest.slice(1) }
      : MCP_PRESETS[name.toLowerCase()];
    if (!cfg) return `No conozco un atajo para "${name}". Dame el comando: /mcp add ${name} <comando> [args…]`;
    try { saveMcpServer(name, cfg); } catch (e: any) { return `No se pudo guardar: ${e?.message ?? e}`; }
    const r = await connectSavedServer(name, loadMcpConfig().servers[name], mcpClientFactory());
    return r.ok
      ? `"${name}" guardado y conectado: ${r.tools} herramientas en el cajón. Se conectará solo cada vez que abras Shinobi.`
      : `"${name}" guardado, pero no se pudo conectar ahora: ${r.error}\nArréglalo y repite /mcp connect ${name} (o /mcp remove ${name}).`;
  }

  if (sub === 'remove' || sub === 'rm') {
    if (!name) return 'Uso: /mcp remove <nombre>';
    await disconnectMcpServer(name);
    return removeMcpServer(name) ? `"${name}" quitado y desconectado.` : `No había ningún servidor guardado con el nombre "${name}".`;
  }

  if (sub === 'connect') {
    if (!name) return 'Uso: /mcp connect <nombre>';
    const cfg = loadMcpConfig().servers[name];
    if (!cfg) return `No hay ningún servidor guardado con el nombre "${name}". Añádelo con /mcp add.`;
    const r = await connectSavedServer(name, cfg, mcpClientFactory());
    return r.ok ? `"${name}" conectado: ${r.tools} herramientas en el cajón.` : `No se pudo conectar "${name}": ${r.error}`;
  }

  if (sub === 'disconnect') {
    if (!name) return 'Uso: /mcp disconnect <nombre>';
    await disconnectMcpServer(name);
    return `"${name}" desconectado (sigue guardado; /mcp connect ${name} lo vuelve a conectar).`;
  }

  if (sub === 'env') {
    const cfg = name ? loadMcpConfig().servers[name] : undefined;
    if (!cfg) return 'Uso: /mcp env <nombre> CLAVE=valor  (CLAVE= sin valor la borra)';
    const env = { ...(cfg.env ?? {}) };
    for (const pair of rest) {
      const i = pair.indexOf('=');
      if (i <= 0) return `No entiendo "${pair}". Formato: CLAVE=valor`;
      const k = pair.slice(0, i); const v = pair.slice(i + 1);
      if (v === '') delete env[k]; else env[k] = v;
    }
    try { saveMcpServer(name, { ...cfg, env: Object.keys(env).length ? env : undefined }); } catch (e: any) { return `No se pudo guardar: ${e?.message ?? e}`; }
    return `Entorno de "${name}" guardado: ${Object.keys(env).join(', ') || '(vacío)'}. Aplica al reconectar: /mcp connect ${name}`;
  }

  return describeMcp();
}
