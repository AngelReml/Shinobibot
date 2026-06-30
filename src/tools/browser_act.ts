// src/tools/browser_act.ts
// Tool de acción: click/type/select/scroll/navigate/press/click_xy por ref.
// Aplica consentimiento (Mejora 5) antes de actuar y devuelve el resultado CON
// el veredicto de verificación (Mejora 3). Ver docs/BROWSER_SUBSYSTEM.md §3.

import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { kageSession } from '../browser/session.js';
import { act } from '../browser/actor.js';
import { requestBrowserConsent } from '../browser/consent.js';
import type { ActCommand } from '../browser/types.js';

const browserAct: Tool = {
  name: 'browser_act',
  description:
    'Ejecuta UNA acción en el navegador. Actúa como un humano: puede clicar por ref ' +
    '(el más fiable, obtenido de browser_observe) o directamente por texto visible, ' +
    'selector CSS o aria-label — sin necesidad de observar antes. ' +
    'Acciones: click, type, select, press, scroll (con scroll_count para lazy-load), ' +
    'navigate, click_xy (canvas/WebGL). Devuelve si la acción quedó VERIFICADA ' +
    '(cambió URL/DOM/pantalla). Usa reobserve:true para recibir el mapa actualizado.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['click', 'type', 'select', 'press', 'scroll', 'navigate', 'click_xy'],
        description: 'Tipo de acción.',
      },
      ref: { type: 'number', description: 'ref del elemento (de browser_observe). Opción más fiable para click.' },
      button_text: { type: 'string', description: 'Texto visible del elemento a clicar (alternativa a ref, sin necesidad de observar).' },
      css_selector: { type: 'string', description: 'Selector CSS del elemento a clicar (alternativa a ref). Usa nth para elegir el Nésimo.' },
      aria_label: { type: 'string', description: 'aria-label del elemento (botones de icono, SVG). Alternativa a ref.' },
      nth: { type: 'number', description: 'Posición 1-indexed cuando css_selector/button_text devuelve múltiples (default 1).' },
      text: { type: 'string', description: 'Texto a escribir (type) o valor/label a seleccionar (select).' },
      url: { type: 'string', description: 'URL destino (navigate).' },
      key: { type: 'string', description: 'Tecla (press): Enter, Escape, Tab, ArrowDown…' },
      dy: { type: 'number', description: 'Píxeles por ciclo de scroll (positivo = abajo). Default 600.' },
      scroll_count: { type: 'number', description: 'Ciclos de scroll para cargar contenido lazy (default 1).' },
      wait_between_ms: { type: 'number', description: 'Ms entre ciclos de scroll (default 1500).' },
      x: { type: 'number', description: 'Coordenada X (click_xy).' },
      y: { type: 'number', description: 'Coordenada Y (click_xy).' },
      reobserve: { type: 'boolean', description: 'Si true, devuelve el mapa de elementos actualizado tras actuar.' },
    },
    required: ['action'],
  },
  categories: ['research', 'coder'],

  async execute(args: ActCommand): Promise<ToolResult> {
    try {
      const session = kageSession();
      const targetRef = args.ref != null
        ? session.lastElements.find(e => e.ref === args.ref)
        : undefined;

      // Mejora 5 — consentimiento independiente del gate global.
      const consent = await requestBrowserConsent(args, targetRef, session.knownHosts);
      if (!consent.allowed) {
        return {
          success: false,
          output: '',
          error: `Acción de navegador no permitida (${consent.reason}). No se ejecutó.`,
        };
      }

      const result = await act(session, args);

      if (args.action === 'navigate' && result.ok) session.rememberHost();
      if (result.snapshot) session.lastElements = result.snapshot.elements;

      if (!result.ok) {
        return { success: false, output: '', error: result.error || result.verdict.why };
      }

      const lines = [
        `${result.detail}.`,
        `Verificación: ${result.verdict.verified ? 'OK' : 'SIN EFECTO OBSERVABLE'} — ${result.verdict.why}.`,
      ];
      if (result.snapshot) {
        lines.push('', 'Estado actualizado:', result.snapshot.text);
      }
      return { success: true, output: lines.join('\n') };
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? String(err) };
    }
  },
};

registerTool(browserAct);
export default browserAct;
