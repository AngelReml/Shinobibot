// F1.2 (RANK #2) — importar el barrel de tools/index.ts NUNCA debe ejecutar
// plugins salvo que SHINOBI_PLUGINS_ENABLED=1 esté activo explícitamente.
// Antes, `loadAllPlugins()` corría incondicionalmente como side-effect del
// propio import — este test coloca un plugin "canario" y confirma que el
// gate lo bloquea.
//
// ALTA-02 (cerrado 2026-07-03): el canario original escribía un marcador con
// `fs.writeFileSync` real desde dentro del propio plugin — eso demostraba
// que el plugin corría SIN sandbox. Ahora `importPlugin` confina el entry en
// isolated-vm (`buildSandboxedTool`), así que un plugin ya NO tiene acceso a
// `fs` real: ese canario dejaría de poder "avisar" que se ejecutó. El nuevo
// canario exporta un Tool que `importPlugin` registra él mismo en el
// tool_registry (host-side, tras pasar el guard) — se detecta la ejecución
// consultando `getTool(...)` en vez de tocar el filesystem real.
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { discoverPlugins, importPlugin } from '../plugin_loader.js';
import { getTool, unregisterTool } from '../../tools/tool_registry.js';

const CANARY_TOOL_NAME = 'shinobi_plugin_canary_tool';

describe('F1.2 — gate SHINOBI_PLUGINS_ENABLED protege la carga de plugins', () => {
  let cwdRoot: string;
  const origCwd = process.cwd;

  afterEach(() => {
    delete process.env.SHINOBI_PLUGINS_ENABLED;
    (process as any).cwd = origCwd;
    try { fs.rmSync(cwdRoot, { recursive: true, force: true }); } catch {}
    unregisterTool(CANARY_TOOL_NAME);
  });

  /** Crea `<cwdRoot>/plugins/canary/` con un manifest válido cuyo entry
   *  exporta un Tool-shaped object. Devuelve `{ cwdRoot, pluginsDir }`. */
  function makeCanaryUnderFreshCwd(): { cwdRoot: string; pluginsDir: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-cwd-'));
    const pluginsDir = path.join(root, 'plugins');
    const sub = path.join(pluginsDir, 'canary');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'shinobi.plugin.json'), JSON.stringify({
      schemaVersion: '1.0',
      name: 'shinobi-plugin-canary',
      version: '1.0.0',
      description: 'F1.2 test canary plugin',
      entry: './index.mjs',
      capabilities: ['tool'],
      sdkVersion: '>=1.0.0',
    }));
    fs.writeFileSync(path.join(sub, 'index.mjs'), `
export default {
  name: ${JSON.stringify(CANARY_TOOL_NAME)},
  description: 'F1.2 canary tool',
  parameters: { type: 'object', properties: {} },
  async execute() { return { success: true, output: 'canary-executed' }; }
};
`);
    return { cwdRoot: root, pluginsDir };
  }

  it('discoverPlugins + importPlugin ejecuta el canario cuando se invoca directo (confirma que el mecanismo SÍ ejecuta código real, para que el resto del test tenga sentido)', async () => {
    const { cwdRoot: root, pluginsDir } = makeCanaryUnderFreshCwd();
    cwdRoot = root;
    const { discovered } = discoverPlugins(pluginsDir);
    expect(discovered.length).toBe(1);
    await importPlugin(discovered[0]);
    expect(getTool(CANARY_TOOL_NAME)).toBeDefined();
  });

  it('maybeLoadPlugins() NO ejecuta nada sin SHINOBI_PLUGINS_ENABLED=1 (default off)', async () => {
    const { cwdRoot: root } = makeCanaryUnderFreshCwd();
    cwdRoot = root;
    delete process.env.SHINOBI_PLUGINS_ENABLED;
    (process as any).cwd = () => root;
    const { maybeLoadPlugins } = await import('../../tools/index.js');
    maybeLoadPlugins();
    await new Promise((r) => setTimeout(r, 300));
    expect(getTool(CANARY_TOOL_NAME)).toBeUndefined();
  });

  it('maybeLoadPlugins() SÍ ejecuta el plugin cuando SHINOBI_PLUGINS_ENABLED=1', async () => {
    const { cwdRoot: root } = makeCanaryUnderFreshCwd();
    cwdRoot = root;
    process.env.SHINOBI_PLUGINS_ENABLED = '1';
    (process as any).cwd = () => root;
    const { maybeLoadPlugins } = await import('../../tools/index.js');
    maybeLoadPlugins();
    for (let i = 0; i < 20 && !getTool(CANARY_TOOL_NAME); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(getTool(CANARY_TOOL_NAME)).toBeDefined();
  });
});
