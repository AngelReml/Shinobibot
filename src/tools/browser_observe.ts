// src/tools/browser_observe.ts
// Tool read-only: devuelve el mapa de elementos interactivos de la pestaña
// activa con refs estables. Es lo PRIMERO que el agente llama antes de actuar.
// Ver docs/BROWSER_SUBSYSTEM.md §3.

import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { kageSession } from '../browser/session.js';
import { snapshot } from '../browser/observer.js';

const browserObserve: Tool = {
  name: 'browser_observe',
  description:
    'Observa la pestaña activa del navegador y devuelve un mapa numerado de sus ' +
    'elementos interactivos (links, botones, inputs) con un "ref" estable para ' +
    'cada uno. Llama esto ANTES de browser_act para saber sobre qué ref actuar. ' +
    'Read-only, sin efectos secundarios. Opcionalmente enfoca una pestaña por URL.',
  parameters: {
    type: 'object',
    properties: {
      url_contains: {
        type: 'string',
        description: 'Opcional: enfoca la pestaña cuya URL contenga esta subcadena.',
      },
      screenshot: {
        type: 'boolean',
        description: 'Opcional: incluir un screenshot reducido (base64). Default false.',
      },
    },
  },
  categories: ['research'],

  async execute(args: { url_contains?: string; screenshot?: boolean }): Promise<ToolResult> {
    try {
      const session = kageSession();
      if (args.url_contains) {
        const ok = await session.focusTabByUrl(args.url_contains);
        if (!ok) {
          return { success: false, output: '', error: `No hay pestaña con URL que contenga "${args.url_contains}".` };
        }
      }
      const page = await session.getPage();
      const snap = await snapshot(page, !!args.screenshot);

      // Memoriza para que browser_act resuelva ref→elemento y consent lea flags.
      session.lastElements = snap.elements;
      session.rememberHost();

      return { success: true, output: snap.text };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? String(err) };
    }
  },
};

registerTool(browserObserve);
export default browserObserve;
