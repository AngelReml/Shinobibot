// F1.2 (RANK #2) — importar el barrel de tools/index.ts NUNCA debe ejecutar
// plugins salvo que SHINOBI_PLUGINS_ENABLED=1 esté activo explícitamente.
// Antes, `loadAllPlugins()` corría incondicionalmente como side-effect del
// propio import — este test coloca un plugin "canario" que escribe un
// archivo marcador si se ejecuta, y confirma que el gate lo bloquea.
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { discoverPlugins, importPlugin } from '../plugin_loader.js';

describe('F1.2 — gate SHINOBI_PLUGINS_ENABLED protege la carga de plugins', () => {
  let cwdRoot: string;
  const origCwd = process.cwd;

  afterEach(() => {
    delete process.env.SHINOBI_PLUGINS_ENABLED;
    (process as any).cwd = origCwd;
    try { fs.rmSync(cwdRoot, { recursive: true, force: true }); } catch {}
  });

  /** Crea `<cwdRoot>/plugins/canary/` con un manifest válido cuyo entry
   *  escribe un marcador en `<cwdRoot>/plugins/canary-executed.marker`
   *  al importarse. Devuelve `{ cwdRoot, pluginsDir, marker }`. */
  function makeCanaryUnderFreshCwd(): { cwdRoot: string; pluginsDir: string; marker: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-cwd-'));
    const pluginsDir = path.join(root, 'plugins');
    const sub = path.join(pluginsDir, 'canary');
    fs.mkdirSync(sub, { recursive: true });
    const marker = path.join(pluginsDir, 'canary-executed.marker');
    fs.writeFileSync(path.join(sub, 'shinobi.plugin.json'), JSON.stringify({
      schemaVersion: '1.0',
      name: 'shinobi-plugin-canary',
      version: '1.0.0',
      description: 'F1.2 test canary plugin',
      entry: './index.mjs',
      capabilities: ['tool'],
      sdkVersion: '>=1.0.0',
    }));
    fs.writeFileSync(path.join(sub, 'index.mjs'),
      `import { writeFileSync } from 'fs';\nwriteFileSync(${JSON.stringify(marker)}, 'executed');\n`);
    return { cwdRoot: root, pluginsDir, marker };
  }

  it('discoverPlugins + importPlugin ejecuta el canario cuando se invoca directo (confirma que el mecanismo SÍ ejecuta código real, para que el resto del test tenga sentido)', async () => {
    const { cwdRoot: root, pluginsDir, marker } = makeCanaryUnderFreshCwd();
    cwdRoot = root;
    const { discovered } = discoverPlugins(pluginsDir);
    expect(discovered.length).toBe(1);
    await importPlugin(discovered[0]);
    expect(fs.existsSync(marker)).toBe(true);
  });

  it('maybeLoadPlugins() NO ejecuta nada sin SHINOBI_PLUGINS_ENABLED=1 (default off)', async () => {
    const { cwdRoot: root, marker } = makeCanaryUnderFreshCwd();
    cwdRoot = root;
    delete process.env.SHINOBI_PLUGINS_ENABLED;
    (process as any).cwd = () => root;
    const { maybeLoadPlugins } = await import('../../tools/index.js');
    maybeLoadPlugins();
    await new Promise((r) => setTimeout(r, 300));
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('maybeLoadPlugins() SÍ ejecuta el plugin cuando SHINOBI_PLUGINS_ENABLED=1', async () => {
    const { cwdRoot: root, marker } = makeCanaryUnderFreshCwd();
    cwdRoot = root;
    process.env.SHINOBI_PLUGINS_ENABLED = '1';
    (process as any).cwd = () => root;
    const { maybeLoadPlugins } = await import('../../tools/index.js');
    maybeLoadPlugins();
    for (let i = 0; i < 20 && !fs.existsSync(marker); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(fs.existsSync(marker)).toBe(true);
  });
});
