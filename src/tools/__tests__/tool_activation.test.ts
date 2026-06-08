// src/tools/__tests__/tool_activation.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import {
  CORE_TOOLS,
  isDeferredMode,
  resetActivatedTools,
  activateTools,
  getActivatedTools,
  computeAdvertisedTools,
} from '../tool_activation.js';
import { registerTool, unregisterTool, type Tool } from '../tool_registry.js';
import toolSearchTool from '../tool_search.js';

const mk = (name: string, description = name): Tool => ({
  name, description, parameters: { type: 'object', properties: {} },
  execute: async () => ({ success: true, output: '' }),
});

afterEach(() => {
  delete process.env.SHINOBI_DEFERRED_TOOLS;
  resetActivatedTools();
});

describe('computeAdvertisedTools', () => {
  const tools = [mk('tool_search'), mk('read_file'), mk('browser_click'), mk('n8n_invoke')];

  it('deferred OFF → devuelve TODAS (sin cambio de comportamiento)', () => {
    const out = computeAdvertisedTools(tools, { deferred: false, activated: new Set() });
    expect(out).toBe(tools);
  });

  it('deferred ON → solo núcleo + activadas existentes', () => {
    const out = computeAdvertisedTools(tools, {
      deferred: true,
      activated: new Set(['tool_search', 'read_file']),
    });
    expect(out.map((t) => t.name).sort()).toEqual(['read_file', 'tool_search']);
  });

  it('deferred ON → una tool activada se incorpora al anuncio', () => {
    const out = computeAdvertisedTools(tools, {
      deferred: true,
      activated: new Set(['tool_search', 'browser_click']),
    });
    expect(out.map((t) => t.name)).toContain('browser_click');
    expect(out.map((t) => t.name)).not.toContain('n8n_invoke');
  });
});

describe('estado de activación', () => {
  it('reset al núcleo, activate añade, get refleja', () => {
    resetActivatedTools(['a', 'b']);
    expect([...getActivatedTools()].sort()).toEqual(['a', 'b']);
    activateTools(['c', 'a']);
    expect([...getActivatedTools()].sort()).toEqual(['a', 'b', 'c']);
    resetActivatedTools();
    expect(getActivatedTools().has('tool_search')).toBe(true); // núcleo por defecto
    expect([...getActivatedTools()].sort()).toEqual([...CORE_TOOLS].sort());
  });

  it('isDeferredMode lee la env (opt-in)', () => {
    expect(isDeferredMode()).toBe(false);
    process.env.SHINOBI_DEFERRED_TOOLS = '1';
    expect(isDeferredMode()).toBe(true);
  });
});

describe('tool_search activa las tools encontradas', () => {
  it('tras buscar, las coincidencias quedan activadas', async () => {
    registerTool(mk('mock_reader', 'read a file from disk'));
    try {
      resetActivatedTools(['tool_search']);
      expect(getActivatedTools().has('mock_reader')).toBe(false);
      const res = await toolSearchTool.execute({ query: 'read file' });
      expect(res.success).toBe(true);
      expect(getActivatedTools().has('mock_reader')).toBe(true);
    } finally {
      unregisterTool('mock_reader');
    }
  });
});
