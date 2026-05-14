/**
 * Plugin Loader — descubre, valida y carga plugins de Shinobi desde un
 * directorio raíz (default `<cwd>/plugins/`).
 *
 *   1. Recorre los subdirectorios de primer nivel.
 *   2. Para cada subdir, busca `shinobi.plugin.json`.
 *   3. Valida el manifest contra el schema.
 *   4. Si valida, dynamic-importa el `entry` con `import(fileURL)`.
 *   5. Devuelve una lista de plugins cargados con su módulo.
 *
 * El loader es **observacional**: no toca el tool_registry ni el
 * provider_router automáticamente — eso es trabajo del módulo que invoque
 * `loadAllPlugins()`. Mantenerlo separado nos permite testear el loader
 * sin side-effects globales.
 *
 * Diferenciador vs Hermes (`tools/registry.py` con auto-registration) y
 * OpenClaw (plugin SDK con 100+ types exportados): Shinobi requiere un
 * manifest explícito, valida fail-fast, y el side-effect lo elige el
 * caller (el plugin no tiene poder global por sí solo).
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { pathToFileURL } from 'url';
import { validateManifest, type PluginManifest, type ValidationResult } from './plugin_manifest.js';

export interface DiscoveredPlugin {
  manifestPath: string;
  manifest: PluginManifest;
  entryAbsPath: string;
}

export interface LoadedPlugin extends DiscoveredPlugin {
  module: unknown;
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
 * Importa dinámicamente el entry de un DiscoveredPlugin. NO ejecuta side
 * effects sobre el tool registry — solo evalúa el módulo y devuelve la
 * referencia. Si el plugin registra tools al importarse (como hacen los
 * tools nativos de Shinobi), eso es responsabilidad del plugin, no del
 * loader.
 */
export async function importPlugin(plugin: DiscoveredPlugin): Promise<unknown> {
  const url = pathToFileURL(plugin.entryAbsPath).href;
  return await import(url);
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
