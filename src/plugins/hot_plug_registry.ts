// src/plugins/hot_plug_registry.ts

import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { createRequire } from 'module';
import { registerTool, unregisterTool, type Tool } from '../tools/tool_registry.js';

const parentRequire = createRequire(import.meta.url);

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

    let registeredToolInstance: Tool | undefined = undefined;

    // Build the VM sandbox
    const moduleObj = { exports: {} as any };
    const sandboxRequire = (moduleName: string) => {
      // Intercept tool registry import
      if (moduleName.includes('tool_registry')) {
        return {
          registerTool: (t: Tool) => {
            registeredToolInstance = t;
          },
          unregisterTool
        };
      }

      // Handle node: prefix
      let resolvedModuleName = moduleName;
      if (resolvedModuleName.startsWith('node:')) {
        resolvedModuleName = resolvedModuleName.substring(5);
      }

      // Handle relative imports
      if (resolvedModuleName.startsWith('.') || path.isAbsolute(resolvedModuleName)) {
        const targetPath = path.resolve(path.dirname(resolvedPath), resolvedModuleName);
        if (targetPath.endsWith('.json') || fs.existsSync(targetPath + '.json')) {
          const jsonPath = targetPath.endsWith('.json') ? targetPath : targetPath + '.json';
          return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        }
        return parentRequire(targetPath);
      }

      return parentRequire(resolvedModuleName);
    };

    const sandbox = {
      console,
      process,
      require: sandboxRequire,
      module: moduleObj,
      exports: moduleObj.exports,
      __dirname: path.dirname(resolvedPath),
      __filename: resolvedPath,
      registerTool: (t: Tool) => {
        registeredToolInstance = t;
      }
    };

    const context = vm.createContext(sandbox);
    const script = new vm.Script(transformed, { filename: resolvedPath });
    script.runInContext(context);

    // If script didn't call registerTool but exported it
    const exported = moduleObj.exports;
    let tool: Tool | undefined = registeredToolInstance;
    if (!tool) {
      if (exported && exported.name && exported.execute) {
        tool = exported as Tool;
      } else if (exported && exported.default && exported.default.name && exported.default.execute) {
        tool = exported.default as Tool;
      }
    }

    if (!tool || !tool.name || typeof tool.execute !== 'function') {
      throw new Error(`Script at ${filePath} did not register or export a valid Tool object.`);
    }

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
