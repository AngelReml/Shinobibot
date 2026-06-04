// src/plugins/hot_plug_registry.ts

import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { createRequire } from 'module';
import { registerTool, unregisterTool, type Tool } from '../tools/tool_registry.js';

const parentRequire = createRequire(import.meta.url);

import ivm from 'isolated-vm';

export function transformEsmToV8Script(code: string): string {
  // Translate multiline and single line: import { a, b } from 'c';
  let transformed = code.replace(
    /import\s+\{([\s\S]+?)\}\s+from\s+['"]([^'"]+)['"];?/g,
    (match, imports, moduleName) => {
      const flatImports = imports.replace(/\s+/g, ' ');
      return `const {${flatImports}} = require('${moduleName}');`;
    }
  );

  // Translate: import * as a from 'c';
  transformed = transformed.replace(
    /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g,
    'const $1 = require(\'$2\');'
  );

  // Translate: import a from 'c';
  transformed = transformed.replace(
    /import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g,
    'const $1 = require(\'$2\').default || require(\'$2\');'
  );

  // Translate: export default x;
  transformed = transformed.replace(
    /export\s+default\s+([^;]+);?/g,
    'module.exports = $1;'
  );

  return transformed;
}

export class HotPlugRegistry {
  private static loadedPlugins: Map<string, { toolName: string; tool: Tool }> = new Map();
  private static watchers: Map<string, fs.FSWatcher> = new Map();

  /**
   * Evaluates the plugin script inside a VM sandbox context.
   */
  public static loadPlugin(filePath: string): Tool {
    const resolvedPath = path.resolve(filePath);
    const rawCode = fs.readFileSync(resolvedPath, 'utf-8');
    const transformed = transformEsmToV8Script(rawCode);

    // 1. Extraer metadata de forma segura
    const extractIsolate = new ivm.Isolate({ memoryLimit: 64 });
    const extractContext = extractIsolate.createContextSync();
    
    extractContext.evalSync(`
      globalThis.console = { log: () => {}, warn: () => {}, error: () => {} };
      globalThis.require = function(mod) { 
        return { registerTool: function(t) { globalThis.__registeredTool = t; } }; 
      };
      globalThis.module = { exports: {} };
    `);

    try {
      extractIsolate.compileScriptSync(transformed).runSync(extractContext, { timeout: 500 });
    } catch(e: any) {
      extractIsolate.dispose();
      throw new Error(`Failed to extract tool metadata from ${filePath}: ${e.message}`);
    }

    const metadataStr = extractContext.evalSync(`
      let t = globalThis.__registeredTool || module.exports.default || module.exports;
      t ? JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters }) : null;
    `);
    extractIsolate.dispose();

    if (!metadataStr) {
      throw new Error(`Script at ${filePath} did not register or export a valid Tool object.`);
    }

    const metadata = JSON.parse(metadataStr);
    if (!metadata.name) {
      throw new Error(`Script at ${filePath} did not register or export a valid Tool object.`);
    }

    // 2. Construir la herramienta envolvente blindada
    const tool: Tool = {
      name: metadata.name,
      description: metadata.description,
      parameters: metadata.parameters,
      execute: async (args: any) => {
        // INSTALACIÓN Y CONFIGURACIÓN DEL ISOLATE
        const isolate = new ivm.Isolate({ memoryLimit: 64 });
        const context = await isolate.createContext();
        
        try {
          const jail = context.global;
          await jail.set('global', jail.derefInto());
          
          // TRANSFERENCIA SEGURA DE ARGUMENTOS (JAIL)
          await jail.set('args', new ivm.ExternalCopy(args).copyInto());
          
          await context.eval(`
            globalThis.console = { log: () => {}, warn: () => {}, error: () => {} };
            globalThis.require = function(mod) { 
              return { registerTool: function(t) { globalThis.__registeredTool = t; } }; 
            };
            globalThis.module = { exports: {} };
          `);

          const script = await isolate.compileScript(transformed, { filename: resolvedPath });
          
          // CONTROL DE TIEMPO DE CPU (TIMEOUT DE 500MS)
          await script.run(context, { timeout: 500 });

          const runner = await isolate.compileScript(`
            (async () => {
              let t = globalThis.__registeredTool || module.exports.default || module.exports;
              if (!t || typeof t.execute !== 'function') throw new Error("tool.execute is not a function");
              const res = await t.execute(globalThis.args);
              return JSON.stringify(res);
            })()
          `);
          
          const resultStr = await runner.run(context, { timeout: 500, promise: true });
          return JSON.parse(resultStr);

        } catch (e: any) {
          return { success: false, output: '', error: `Sandbox Error: ${e.message}` };
        } finally {
          // ELIMINACIÓN DE RESIDUOS (GARBAGE COLLECTION)
          context.release();
          isolate.dispose();
        }
      }
    };

    // Overwrite existing tool if already loaded from this path
    const old = this.loadedPlugins.get(resolvedPath);
    if (old) {
      unregisterTool(old.toolName);
    }

    // Register with global registry
    registerTool(tool);

    // Store in our tracking map
    this.loadedPlugins.set(resolvedPath, { toolName: tool.name, tool });

    return tool;
  }

  /**
   * Unloads a plugin script by file path.
   */
  public static unloadPlugin(filePath: string): void {
    const resolvedPath = path.resolve(filePath);
    const loaded = this.loadedPlugins.get(resolvedPath);
    if (loaded) {
      unregisterTool(loaded.toolName);
      this.loadedPlugins.delete(resolvedPath);
    }
  }

  /**
   * Recursively scans and loads all .mjs/.js plugins in a folder.
   */
  public static loadDirectory(directoryPath: string): Tool[] {
    const resolvedDir = path.resolve(directoryPath);
    if (!fs.existsSync(resolvedDir)) {
      return [];
    }

    const loadedTools: Tool[] = [];
    const scan = (dir: string) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          scan(fullPath);
        } else if (stat.isFile() && (file.endsWith('.js') || file.endsWith('.mjs'))) {
          // Skip test files
          if (file.includes('.test.') || file.includes('.spec.')) {
            continue;
          }
          try {
            const tool = this.loadPlugin(fullPath);
            loadedTools.push(tool);
          } catch (e: any) {
            console.warn(`[HotPlugRegistry] Failed to load ${fullPath}: ${e.message}`);
          }
        }
      }
    };

    scan(resolvedDir);
    return loadedTools;
  }

  /**
   * Watches a directory (recursively on supported platforms) and reloads files on change.
   */
  public static watchDirectory(directoryPath: string): void {
    const resolvedDir = path.resolve(directoryPath);
    if (!fs.existsSync(resolvedDir)) {
      return;
    }

    // Close existing watcher if any
    const existing = this.watchers.get(resolvedDir);
    if (existing) {
      existing.close();
    }

    const watcher = fs.watch(resolvedDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const fullPath = path.join(resolvedDir, filename);

      if (filename.endsWith('.js') || filename.endsWith('.mjs')) {
        if (filename.includes('.test.') || filename.includes('.spec.')) {
          return;
        }

        try {
          if (fs.existsSync(fullPath)) {
            // Load/Reload
            this.loadPlugin(fullPath);
            console.log(`[HotPlugRegistry] Hot-loaded plugin: ${filename}`);
          } else {
            // Unload on file deletion
            this.unloadPlugin(fullPath);
            console.log(`[HotPlugRegistry] Unloaded plugin: ${filename}`);
          }
        } catch (e: any) {
          console.warn(`[HotPlugRegistry] Error hot-loading ${filename}: ${e.message}`);
        }
      }
    });

    this.watchers.set(resolvedDir, watcher);
  }

  /**
   * Stops watching all directories and clears loaded plugins.
   */
  public static clear(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();

    for (const resolvedPath of this.loadedPlugins.keys()) {
      this.unloadPlugin(resolvedPath);
    }
    this.loadedPlugins.clear();
  }

  public static getLoadedPlugins(): Map<string, { toolName: string; tool: Tool }> {
    return this.loadedPlugins;
  }
}
