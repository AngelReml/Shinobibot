// src/plugins/__tests__/hot_plug_registry.test.ts

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HotPlugRegistry } from '../hot_plug_registry.js';
import { getTool } from '../../tools/tool_registry.js';

describe('HotPlugRegistry', () => {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'scratch', 'test-plugins-'));

  afterEach(() => {
    HotPlugRegistry.clear();
    // Clean up files in tmpDir
    if (fs.existsSync(tmpDir)) {
      const files = fs.readdirSync(tmpDir);
      for (const f of files) {
        fs.unlinkSync(path.join(tmpDir, f));
      }
    }
  });

  it('compila y registra un plugin de forma dinámica a través de vm y CJS/ESM bridging', async () => {
    const file = path.join(tmpDir, 'mock_tool_1.js');
    fs.writeFileSync(file, `
      import { registerTool } from '../../src/tools/tool_registry.js';
      const tool = {
        name: 'vm_mock_tool',
        description: 'Mock tool compiled inside VM sandbox',
        parameters: { type: 'object', properties: {} },
        async execute(args) {
          return { success: true, output: 'Hello VM!' };
        }
      };
      registerTool(tool);
    `, 'utf-8');

    const loadedTool = HotPlugRegistry.loadPlugin(file);
    expect(loadedTool.name).toBe('vm_mock_tool');

    const registryTool = getTool('vm_mock_tool');
    expect(registryTool).toBeDefined();
    expect(registryTool!.description).toBe('Mock tool compiled inside VM sandbox');

    const result = await registryTool!.execute({});
    expect(result.success).toBe(true);
    expect(result.output).toBe('Hello VM!');
  });

  it('actualiza y reemplaza la herramienta existente sin fugas en la recarga', async () => {
    const file = path.join(tmpDir, 'mock_tool_reload.js');
    
    // Versión 1
    fs.writeFileSync(file, `
      export default {
        name: 'vm_reload_tool',
        description: 'Version 1',
        parameters: { type: 'object', properties: {} },
        async execute() { return { success: true, output: 'V1' }; }
      };
    `, 'utf-8');

    HotPlugRegistry.loadPlugin(file);
    expect(getTool('vm_reload_tool')!.description).toBe('Version 1');

    // Versión 2
    fs.writeFileSync(file, `
      export default {
        name: 'vm_reload_tool',
        description: 'Version 2',
        parameters: { type: 'object', properties: {} },
        async execute() { return { success: true, output: 'V2' }; }
      };
    `, 'utf-8');

    HotPlugRegistry.loadPlugin(file);
    expect(getTool('vm_reload_tool')!.description).toBe('Version 2');
    const res = await getTool('vm_reload_tool')!.execute({});
    expect(res.output).toBe('V2');
  });

  it('descarga la herramienta cuando se elimina o se solicita explícitamente', () => {
    const file = path.join(tmpDir, 'mock_tool_delete.js');
    fs.writeFileSync(file, `
      export default {
        name: 'vm_delete_tool',
        description: 'ToDelete',
        parameters: { type: 'object', properties: {} },
        async execute() { return { success: true, output: 'Deleted' }; }
      };
    `, 'utf-8');

    HotPlugRegistry.loadPlugin(file);
    expect(getTool('vm_delete_tool')).toBeDefined();

    HotPlugRegistry.unloadPlugin(file);
    expect(getTool('vm_delete_tool')).toBeUndefined();
  });

  it('carga un directorio completo y observa los cambios de forma reactiva', async () => {
    const file1 = path.join(tmpDir, 'dir_tool_1.js');
    fs.writeFileSync(file1, `
      export default {
        name: 'dir_tool_1',
        description: 'Dir1',
        parameters: { type: 'object', properties: {} },
        async execute() { return { success: true, output: 'dir1' }; }
      };
    `, 'utf-8');

    const tools = HotPlugRegistry.loadDirectory(tmpDir);
    expect(tools.length).toBeGreaterThanOrEqual(1);
    expect(getTool('dir_tool_1')).toBeDefined();

    // Start watching
    HotPlugRegistry.watchDirectory(tmpDir);

    // Write a new file
    const file2 = path.join(tmpDir, 'dir_tool_2.js');
    fs.writeFileSync(file2, `
      export default {
        name: 'dir_tool_2',
        description: 'Dir2',
        parameters: { type: 'object', properties: {} },
        async execute() { return { success: true, output: 'dir2' }; }
      };
    `, 'utf-8');

    // Wait a short time for fs.watch to catch the event
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(getTool('dir_tool_2')).toBeDefined();

    // Delete the file
    fs.unlinkSync(file2);
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(getTool('dir_tool_2')).toBeUndefined();
  });

  it('interrumpe un script malicioso con bucle infinito por timeout en el Isolate', async () => {
    const file = path.join(tmpDir, 'mock_tool_infinite.js');
    fs.writeFileSync(file, `
      export default {
        name: 'vm_infinite_tool',
        description: 'Infinite loop test',
        parameters: { type: 'object', properties: {} },
        async execute() {
          while (true) {}
          return { success: true };
        }
      };
    `, 'utf-8');

    HotPlugRegistry.loadPlugin(file);
    const registryTool = getTool('vm_infinite_tool');
    expect(registryTool).toBeDefined();

    const start = Date.now();
    const result = await registryTool!.execute({});
    const elapsed = Date.now() - start;

    expect(result.success).toBe(false);
    expect(result.error).toContain('Sandbox Error');
    expect(result.error).toContain('Script execution timed out');
    // Ensure it took roughly ~500ms
    expect(elapsed).toBeGreaterThanOrEqual(450);
  });
});
