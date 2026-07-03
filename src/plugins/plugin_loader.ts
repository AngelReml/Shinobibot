/**
 * Plugin Loader — descubre, valida y carga plugins de Shinobi desde un
 * directorio raíz (default `<cwd>/plugins/`).
 *
 *   1. Recorre los subdirectorios de primer nivel.
 *   2. Para cada subdir, busca `shinobi.plugin.json`.
 *   3. Valida el manifest contra el schema.
 *   4. Si valida, confina y evalúa el `entry` dentro de un isolate
 *      `isolated-vm` (ver ALTA-02 más abajo) y registra el Tool resultante.
 *   5. Devuelve una lista de plugins cargados con su Tool.
 *
 * Diferenciador vs Hermes (`tools/registry.py` con auto-registration) y
 * OpenClaw (plugin SDK con 100+ types exportados): Shinobi requiere un
 * manifest explícito, valida fail-fast, y el side-effect lo elige el
 * caller (el plugin no tiene poder global por sí solo).
 *
 * ALTA-02 (auditoría 2026-06-30, cerrada 2026-07-03): `importPlugin` YA NO
 * usa `import(url)` nativo. Antes de evaluar el entry: 1) lee el source y lo
 * pasa por `scanForbidden` (`confine/ast_guard.ts`, guard por AST) — código
 * con identificadores prohibidos (`process`, `require`, `eval`, `Function`,
 * `child_process`, `globalThis`, `Reflect`, `WebAssembly`, `Proxy`), acceso
 * computado por string o `import()` dinámico se RECHAZA fail-closed antes de
 * ejecutarse; 2) el entry que pasa el guard se compila y corre en un isolate
 * `isolated-vm` nuevo por invocación vía `buildSandboxedTool` (reusado de
 * `hot_plug_registry.ts` — mismo mecanismo, sin integrar ivm dos veces a
 * mano). `importPlugin` devuelve el `Tool` sandboxed y lo registra él mismo
 * en el tool_registry (el plugin ya no puede llamar a `registerTool` desde
 * dentro del isolate — no tiene acceso a módulos reales del host), pero
 * SIGUE marcando el contexto de carga como 'plugin' (`setToolLoadSource`)
 * durante ese registro para que la protección de overwrite de
 * `tool_registry.ts` (bloquea que un plugin reemplace un tool nativo en
 * silencio) siga intacta. Esto NARROWEA el contrato del loader: un entry
 * debe exportar (o registrar vía el stub `require().registerTool`) un
 * objeto Tool-shaped — exports genéricos de datos sin forma de Tool ya no
 * son recuperables a través del límite del isolate (ver tests).
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { validateManifest, type PluginManifest, type ValidationResult } from './plugin_manifest.js';
import { setToolLoadSource, registerTool, type Tool } from '../tools/tool_registry.js';
import { scanForbidden } from '../confine/ast_guard.js';
import { buildSandboxedTool } from './hot_plug_registry.js';

export interface DiscoveredPlugin {
  manifestPath: string;
  manifest: PluginManifest;
  entryAbsPath: string;
}

export interface LoadedPlugin extends DiscoveredPlugin {
  module: Tool;
}

export interface LoadError {
  manifestPath: string;
  errors: string[];
}

export interface LoadResult {
  loaded: LoadedPlugin[];
  errors: LoadError[];
}

export interface DiscoveryResult {
  discovered: DiscoveredPlugin[];
  errors: LoadError[];
}

/**
 * Recorre el directorio raíz buscando manifests válidos.
 * Si `rootDir` no existe, devuelve listas vacías sin lanzar.
 */
export function discoverPlugins(rootDir: string): DiscoveryResult {
  const discovered: DiscoveredPlugin[] = [];
  const errors: LoadError[] = [];
  const root = resolve(rootDir);
  if (!existsSync(root)) return { discovered, errors };
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return { discovered, errors };
  }
  for (const name of entries) {
    const sub = join(root, name);
    let isDir = false;
    try { isDir = statSync(sub).isDirectory(); } catch { isDir = false; }
    if (!isDir) continue;
    const manifestPath = join(sub, 'shinobi.plugin.json');
    if (!existsSync(manifestPath)) continue;
    let raw = '';
    try {
      raw = readFileSync(manifestPath, 'utf-8');
    } catch (e: any) {
      errors.push({ manifestPath, errors: [`no se pudo leer manifest: ${e?.message ?? e}`] });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e: any) {
      errors.push({ manifestPath, errors: [`JSON inválido: ${e?.message ?? e}`] });
      continue;
    }
    const v: ValidationResult = validateManifest(parsed);
    if (!v.ok || !v.manifest) {
      errors.push({ manifestPath, errors: v.errors });
      continue;
    }
    const entryAbsPath = resolve(dirname(manifestPath), v.manifest.entry);
    if (!existsSync(entryAbsPath)) {
      errors.push({ manifestPath, errors: [`entry file no encontrado: ${entryAbsPath}`] });
      continue;
    }
    discovered.push({ manifestPath, manifest: v.manifest, entryAbsPath });
  }
  return { discovered, errors };
}

/**
 * Carga (confinada) el entry de un DiscoveredPlugin y devuelve el `Tool`
 * sandboxed. Fail-closed en dos capas:
 *   1. `scanForbidden` sobre el source — rechaza identificadores/patrones de
 *      escape ANTES de compilar o ejecutar una sola línea.
 *   2. `buildSandboxedTool` — compila y ejecuta el entry dentro de un
 *      isolate `isolated-vm` (memoryLimit + timeout), igual que
 *      `hot_plug_registry.ts`. Nunca usa `eval`/`import()` nativo.
 * Registra el Tool resultante marcando el contexto de carga como 'plugin'
 * (`setToolLoadSource`) para que la protección de overwrite de
 * `tool_registry.ts` siga aplicando. SIEMPRE restaura a 'native' en el
 * finally, incluso si la carga lanza.
 */
export async function importPlugin(plugin: DiscoveredPlugin): Promise<Tool> {
  const source = readFileSync(plugin.entryAbsPath, 'utf-8');
  const scan = scanForbidden(source);
  if (!scan.safe) {
    throw new Error(
      `plugin rechazado por confinamiento AST (ALTA-02, fail-closed): ${scan.findings.join('; ')}`
    );
  }
  setToolLoadSource('plugin');
  try {
    const tool = buildSandboxedTool(plugin.entryAbsPath, source);
    registerTool(tool);
    return tool;
  } finally {
    setToolLoadSource('native');
  }
}

/** Conveniencia: discover + import secuencial, con errores agregados. */
export async function loadAllPlugins(rootDir: string): Promise<LoadResult> {
  const { discovered, errors } = discoverPlugins(rootDir);
  const loaded: LoadedPlugin[] = [];
  for (const d of discovered) {
    try {
      const mod = await importPlugin(d);
      loaded.push({ ...d, module: mod });
    } catch (e: any) {
      errors.push({ manifestPath: d.manifestPath, errors: [`import falló: ${e?.message ?? e}`] });
    }
  }
  return { loaded, errors };
}
