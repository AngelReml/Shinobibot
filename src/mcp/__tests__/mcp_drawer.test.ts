// src/mcp/__tests__/mcp_drawer.test.ts
//
// El "cajón" MCP: las tools de un servidor MCP no se anuncian hasta que
// tool_search las saca, los servidores guardados (mcp.json) se conectan solos,
// y lo que el servidor marca como destructivo pasa por el candado.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { registerMcpServer, disconnectMcpServer, mcpServerSummaries, _resetMcp } from '../mcp_registry.js';
import {
  parseMcpConfig, loadMcpConfig, saveMcpServer, removeMcpServer, connectSavedServer,
  ensureMcpAutoConnected, _resetMcpAutoConnect, toStdioConfig, MCP_PRESETS, mcpAutoConnectEnabled,
} from '../mcp_config.js';
import { handleMcpCommand, splitArgs } from '../mcp_command.js';
import { mcpCallTimeoutMs, networkEnv } from '../stdio_client.js';
import { __setMcpClientFactoryForTest } from '../../tools/mcp_connect.js';
import toolSearchTool, { resolveToolNames, scopeToServer, describeMcpTools } from '../../tools/tool_search.js';
import mcpCallTool from '../../tools/mcp_call.js';
import { computeAdvertisedTools, getActivatedTools, resetActivatedTools, mcpDrawerHint, isMcpTool, CORE_TOOLS } from '../../tools/tool_activation.js';
import { getAllTools, type Tool } from '../../tools/tool_registry.js';
import { classifyCritical, mcpTargetName } from '../../security/approval.js';
import type { McpClient, McpToolDef } from '../types.js';

const DEFS: McpToolDef[] = [
  { name: 'open_binary', description: 'Open a native binary for analysis', annotations: { destructiveHint: false }, inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Absolute path' } }, required: ['path'] } },
  { name: 'analyze_javascript_application', description: 'Build a static application graph from an ASAR' },
  { name: 'install_adb_package', description: 'Install an APK on a device', annotations: { destructiveHint: true } },
];

function fakeClient(defs = DEFS, state: { closed?: boolean; calls?: any[] } = {}): McpClient {
  return {
    async listTools() { return defs; },
    async callTool(name, args) { state.calls?.push([name, args]); return { content: [{ type: 'text', text: `ok ${name}` }] }; },
    async close() { state.closed = true; },
  };
}

const native = (name: string): Tool => ({ name, description: name, parameters: { type: 'object', properties: {} }, async execute() { return { success: true, output: '' }; } });

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-mcp-'));
  process.env.SHINOBI_MCP_FILE = path.join(tmp, 'mcp.json');
  resetActivatedTools();
  delete process.env.SHINOBI_MCP_EAGER;
  _resetMcpAutoConnect();
});
afterEach(async () => {
  await _resetMcp();
  __setMcpClientFactoryForTest(null);
  delete process.env.SHINOBI_MCP_FILE;
  delete process.env.SHINOBI_MCP;
  delete process.env.SHINOBI_MCP_TIMEOUT_MS;
  delete process.env.SHINOBI_MCP_EAGER;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('cajón MCP — qué se anuncia', () => {
  it('las tools MCP no se anuncian nunca (ni con deferred ni sin él); la pasarela mcp_call sí', async () => {
    await registerMcpServer('rea', fakeClient());
    const all = [native('read_file'), native('mcp_call'), ...getAllTools().filter(isMcpTool)];
    expect(computeAdvertisedTools(all, { deferred: false, activated: new Set(['mcp__rea__open_binary']) }).map((t) => t.name)).toEqual(['read_file', 'mcp_call']);
    expect(computeAdvertisedTools(all, { deferred: true, activated: new Set([...CORE_TOOLS, 'mcp__rea__open_binary']) }).map((t) => t.name)).toEqual(['read_file', 'mcp_call']);
  });

  it('mcpEager anuncia todas (el comportamiento antiguo, para medir)', async () => {
    await registerMcpServer('rea', fakeClient());
    const all = [native('read_file'), ...getAllTools().filter(isMcpTool)];
    expect(computeAdvertisedTools(all, { deferred: false, activated: new Set(), mcpEager: true })).toHaveLength(4);
  });

  it('el aviso de sistema nombra el servidor y es estable; vacío si no hay servidores', async () => {
    expect(mcpDrawerHint([])).toBe('');
    await registerMcpServer('rea', fakeClient());
    expect(mcpServerSummaries()).toEqual([{ name: 'rea', total: 3 }]);
    const h = mcpDrawerHint([{ name: 'rea', total: 263 }]);
    expect(h).toContain('rea: 263 herramientas');
    expect(h).toContain('tool_search');
    expect(h).toContain('mcp_call');
    expect(mcpDrawerHint([{ name: 'rea', total: 263 }])).toBe(h);
  });
});

describe('cajón MCP — tool_search las encuentra y mcp_call las llama', () => {
  it('names acepta el nombre corto o el completo y devuelve la ficha con el esquema, sin anunciar nada', async () => {
    await registerMcpServer('rea', fakeClient());
    const before = [...getActivatedTools()];
    const r = await toolSearchTool.execute({ names: ['open_binary', 'mcp__rea__install_adb_package', 'no_existe'] });
    expect(r.success).toBe(true);
    expect(r.output).toContain('### open_binary');
    expect(r.output).toContain('mcp_call({"server":"rea","tool":"open_binary"');
    expect(r.output).toContain('"required":["path"]');
    expect(r.output).toContain('### install_adb_package');
    expect(r.output).toContain('no_existe');
    expect([...getActivatedTools()]).toEqual(before);
  });

  it('un nombre corto repetido en dos servidores no se resuelve solo', async () => {
    await registerMcpServer('rea', fakeClient());
    await registerMcpServer('otro', fakeClient([{ name: 'open_binary' }]));
    const tools = getAllTools();
    expect(resolveToolNames(['open_binary'], tools).missing).toEqual(['open_binary']);
    expect(resolveToolNames(['open_binary'], scopeToServer(tools, 'otro')).found).toEqual(['mcp__otro__open_binary']);
  });

  it('server + query busca solo en ese servidor y devuelve fichas', async () => {
    await registerMcpServer('rea', fakeClient());
    const r = await toolSearchTool.execute({ server: 'rea', query: 'javascript application graph' });
    expect(r.output).toContain('### analyze_javascript_application');
    expect(r.output).not.toMatch(/- read_file/);
    const bad = await toolSearchTool.execute({ server: 'nadie', query: 'x' });
    expect(bad.success).toBe(false);
  });

  it('una ficha que no cabe en el presupuesto se recorta y dice cómo verla entera', async () => {
    await registerMcpServer('rea', fakeClient([{ name: 'grande', description: 'x'.repeat(9000) }, { name: 'otra', description: 'y' }]));
    const tools = getAllTools().filter(isMcpTool);
    const txt = describeMcpTools(tools, 3000);
    expect(txt).toContain('ficha recortada');
    expect(txt).toContain('names=["grande"]');
    expect(txt.length).toBeLessThan(4500);
  });

  it('mcp_call llama a la herramienta con sus argumentos (también si llegan como texto JSON)', async () => {
    const state = { calls: [] as any[] };
    await registerMcpServer('rea', fakeClient(DEFS, state));
    const r = await mcpCallTool.execute({ server: 'rea', tool: 'open_binary', args: { path: '/x' } });
    expect(r).toMatchObject({ success: true, output: 'ok open_binary' });
    await mcpCallTool.execute({ server: 'rea', tool: 'mcp__rea__open_binary', args: '{"path":"/y"}' });
    expect(state.calls).toEqual([['open_binary', { path: '/x' }], ['open_binary', { path: '/y' }]]);
  });

  it('mcp_call explica lo que falla: sin servidores, servidor desconocido, herramienta desconocida', async () => {
    expect((await mcpCallTool.execute({ server: 'rea', tool: 'x' })).error).toMatch(/No hay ningún servidor MCP conectado/);
    await registerMcpServer('rea', fakeClient());
    expect((await mcpCallTool.execute({ server: 'otro', tool: 'x' })).error).toMatch(/Conectados: rea/);
    expect((await mcpCallTool.execute({ server: 'rea', tool: 'open' })).error).toMatch(/Parecidas: open_binary/);
    expect((await mcpCallTool.execute({ server: 'rea' })).error).toMatch(/requiere/);
  });
});

describe('cajón MCP — candado', () => {
  it('lo que el servidor marca destructivo requiere aprobación; el resto no; al desconectar se olvida', async () => {
    await registerMcpServer('rea', fakeClient());
    expect(classifyCritical('mcp__rea__install_adb_package', {}).destructive).toBe(true);
    expect(classifyCritical('mcp__rea__open_binary', {}).destructive).toBe(false);
    // Lo mismo cuando la llamada entra por la pasarela.
    expect(mcpTargetName({ server: 'rea', tool: 'install_adb_package' })).toBe('mcp__rea__install_adb_package');
    expect(classifyCritical('mcp_call', { server: 'rea', tool: 'install_adb_package', args: {} }).destructive).toBe(true);
    expect(classifyCritical('mcp_call', { server: 'rea', tool: 'open_binary' }).destructive).toBe(false);
    await disconnectMcpServer('rea');
    expect(classifyCritical('mcp__rea__install_adb_package', {}).destructive).toBe(false);
  });
});

describe('mcp.json — servidores guardados', () => {
  it('parseMcpConfig acepta servers y mcpServers, limpia y descarta lo mal formado', () => {
    const { servers, problems } = parseMcpConfig({ mcpServers: {
      rea: { command: ' npx ', args: ['-y', 3, 'rea-agents'], env: { A: 1, 'mal nombre': 'x' }, disabled: true },
      'no válido!': { command: 'x' },
      vacio: {},
    } });
    expect(servers).toEqual({ rea: { command: 'npx', args: ['-y', 'rea-agents'], env: { A: '1' }, disabled: true } });
    expect(problems).toHaveLength(2);
    expect(parseMcpConfig(null).servers).toEqual({});
  });

  it('guardar, leer y quitar; el cwd por defecto no es el proyecto abierto', () => {
    saveMcpServer('rea', MCP_PRESETS.rea);
    expect(loadMcpConfig().servers.rea.command).toBe('npx');
    expect(MCP_PRESETS.rea.args?.join(' ')).toMatch(/rea-agents@\d+\.\d+\.\d+ mcp$/); // versión fijada, no @latest
    expect(toStdioConfig('rea', loadMcpConfig().servers.rea).cwd).not.toBe(process.cwd());
    expect(() => saveMcpServer('mal nombre', { command: 'x' })).toThrow();
    expect(removeMcpServer('rea')).toBe(true);
    expect(removeMcpServer('rea')).toBe(false);
  });

  it('un mcp.json roto no rompe nada: se avisa', () => {
    fs.writeFileSync(process.env.SHINOBI_MCP_FILE!, '{ roto');
    const { servers, problems } = loadMcpConfig();
    expect(servers).toEqual({});
    expect(problems[0]).toMatch(/ilegible/);
  });

  it('la autoconexión conecta lo guardado una sola vez, salta lo deshabilitado y aguanta un fallo', async () => {
    saveMcpServer('rea', { command: 'x' });
    saveMcpServer('roto', { command: 'y' });
    saveMcpServer('apagado', { command: 'z', disabled: true });
    let n = 0;
    const factory = async (cfg: any) => { n++; if (cfg.name === 'roto') throw new Error('no arranca'); return fakeClient(); };
    const out = await ensureMcpAutoConnected(factory);
    expect(out.map((r) => [r.name, r.ok]).sort()).toEqual([['rea', true], ['roto', false]]);
    expect(out.find((r) => r.name === 'roto')!.error).toMatch(/no arranca/);
    await ensureMcpAutoConnected(factory);
    expect(n).toBe(2);
    expect(mcpServerSummaries().map((s) => s.name)).toEqual(['rea']);
  });

  it('SHINOBI_MCP=0 apaga la autoconexión', async () => {
    process.env.SHINOBI_MCP = '0';
    expect(mcpAutoConnectEnabled()).toBe(false);
    saveMcpServer('rea', { command: 'x' });
    expect(await ensureMcpAutoConnected(async () => fakeClient())).toEqual([]);
  });

  it('un servidor que no contesta se corta con un aviso, y si arranca tarde se cierra', async () => {
    const r = await connectSavedServer('lento', { command: 'x' }, () => new Promise(() => {}), 30);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no respondió/);
    const state: { closed?: boolean } = {};
    const late = await connectSavedServer('tarde', { command: 'x' }, () => new Promise((res) => setTimeout(() => res(fakeClient(DEFS, state)), 60)), 20);
    expect(late.ok).toBe(false);
    await new Promise((res) => setTimeout(res, 80));
    expect(state.closed).toBe(true);
    expect(mcpServerSummaries()).toEqual([]);
  });

  it('al servidor se le pasan los ajustes de red de la máquina, nunca claves', () => {
    const env = networkEnv({ HTTPS_PROXY: 'http://p:1', no_proxy: 'localhost', NODE_EXTRA_CA_CERTS: '/ca.pem', npm_config_registry: 'https://r', ANTHROPIC_API_KEY: 'sk-x', GITHUB_TOKEN: 't', PATH: '/bin' } as any);
    expect(env).toEqual({ HTTPS_PROXY: 'http://p:1', no_proxy: 'localhost', NODE_EXTRA_CA_CERTS: '/ca.pem', npm_config_registry: 'https://r' });
  });

  it('el tope de espera por llamada es 10 min por defecto y se puede cambiar', () => {
    expect(mcpCallTimeoutMs()).toBe(600_000);
    process.env.SHINOBI_MCP_TIMEOUT_MS = '90000';
    expect(mcpCallTimeoutMs()).toBe(90_000);
    expect(mcpCallTimeoutMs(5000)).toBe(5000);
  });
});

describe('/mcp', () => {
  it('splitArgs respeta comillas (rutas con espacios)', () => {
    expect(splitArgs('add rea node "C:\\Users\\a b\\rea.mjs" mcp')).toEqual(['add', 'rea', 'node', 'C:\\Users\\a b\\rea.mjs', 'mcp']);
  });

  it('add con atajo guarda y conecta; list lo enseña; env, disconnect y remove', async () => {
    __setMcpClientFactoryForTest(async () => fakeClient());
    const added = await handleMcpCommand('add rea');
    expect(added).toMatch(/guardado y conectado: 3 herramientas/);
    expect(loadMcpConfig().servers.rea.args).toEqual(MCP_PRESETS.rea.args);
    expect(await handleMcpCommand('')).toMatch(/rea: npx .*\n\s+→ conectado · 3 herramientas en el cajón/);
    expect(await handleMcpCommand('env rea REA_MCP_TOOL_FAMILIES=session,javascript')).toMatch(/REA_MCP_TOOL_FAMILIES/);
    expect(loadMcpConfig().servers.rea.env).toEqual({ REA_MCP_TOOL_FAMILIES: 'session,javascript' });
    expect(await handleMcpCommand('disconnect rea')).toMatch(/desconectado/);
    expect(mcpServerSummaries()).toEqual([]);
    expect(await handleMcpCommand('remove rea')).toMatch(/quitado/);
    expect(loadMcpConfig().servers).toEqual({});
  });

  it('add con comando propio; sin atajo ni comando lo dice; si no conecta queda guardado con el motivo', async () => {
    __setMcpClientFactoryForTest(async () => { throw new Error('spawn ENOENT'); });
    expect(await handleMcpCommand('add cosa')).toMatch(/No conozco un atajo/);
    const r = await handleMcpCommand('add cosa node "C:\\x y\\srv.js" --flag');
    expect(r).toMatch(/guardado, pero no se pudo conectar ahora: spawn ENOENT/);
    expect(loadMcpConfig().servers.cosa).toEqual({ command: 'node', args: ['C:\\x y\\srv.js', '--flag'] });
  });
});
