// Regresión ALTA-02 / BAJA-03 (auditoría 2026-07-01): un plugin de terceros
// (import() sin sandbox) podía registrar un tool con el mismo nombre que uno
// nativo (p.ej. run_command) y reemplazarlo en silencio, tirando sus checks
// de seguridad. registerTool() ahora distingue el origen y bloquea ese
// overwrite concreto, avisando en cualquier otro caso de reemplazo.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  registerTool,
  unregisterTool,
  getTool,
  getToolSource,
  setToolLoadSource,
} from '../tool_registry.js';

function fakeTool(name: string, extra: Partial<any> = {}) {
  return { name, description: 'test', parameters: {}, execute: async () => 'ok', ...extra } as any;
}

describe('tool_registry — origen de registro (ALTA-02 / BAJA-03)', () => {
  afterEach(() => {
    unregisterTool('__test_native_tool__');
    unregisterTool('__test_plugin_tool__');
    setToolLoadSource('native');
  });

  it('un tool nativo se registra normalmente con source=native', () => {
    registerTool(fakeTool('__test_native_tool__'));
    expect(getTool('__test_native_tool__')).toBeDefined();
    expect(getToolSource('__test_native_tool__')).toBe('native');
  });

  it('un plugin NO puede sobreescribir un tool nativo existente (ALTA-02)', () => {
    registerTool(fakeTool('__test_native_tool__', { description: 'nativo original' }));
    setToolLoadSource('plugin');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerTool(fakeTool('__test_native_tool__', { description: 'plugin malicioso' }));
    warnSpy.mockRestore();

    // El nativo original queda intacto — el registro del plugin se ignoró.
    expect(getTool('__test_native_tool__')!.description).toBe('nativo original');
    expect(getToolSource('__test_native_tool__')).toBe('native');
  });

  it('un plugin SÍ puede registrar un tool nuevo (sin colisión con nativo)', () => {
    setToolLoadSource('plugin');
    registerTool(fakeTool('__test_plugin_tool__'));
    expect(getTool('__test_plugin_tool__')).toBeDefined();
    expect(getToolSource('__test_plugin_tool__')).toBe('plugin');
  });

  it('cualquier otro overwrite (no nativo→plugin) se permite pero se loguea (BAJA-03)', () => {
    registerTool(fakeTool('__test_native_tool__', { description: 'v1' }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerTool(fakeTool('__test_native_tool__', { description: 'v2' })); // nativo→nativo (hot-reload)
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
    expect(getTool('__test_native_tool__')!.description).toBe('v2');
  });
});
