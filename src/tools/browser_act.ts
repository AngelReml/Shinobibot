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
    'Ejecuta UNA acción en el navegador sobre un elemento identificado por su ' +
    '"ref" (obtenido de browser_observe). Acciones: click, type (escribir), ' +
    'select, press (tecla), scroll, navigate (ir a URL), click_xy (click crudo ' +
    'por coordenadas, solo para canvas/WebGL). Devuelve si la acción quedó ' +
    'VERIFICADA (cambió URL/DOM/pantalla). Acciones sensibles (contraseñas, ' +
    'envíos, hosts nuevos) pueden pedir tu permiso. Usa reobserve:true para ' +
    'recibir el nuevo mapa de elementos tras la acción.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['click', 'type', 'select', 'press', 'scroll', 'navigate', 'click_xy'],
        description: 'Tipo de acción.',
      },
      ref: { type: 'number', description: 'ref del elemento (de browser_observe). Requerido para click/type/select/press dirigido.' },
      text: { type: 'string', description: 'Texto a escribir (type) o valor/label a seleccionar (select).' },
      url: { type: 'string', description: 'URL destino (navigate).' },
      key: { type: 'string', description: 'Tecla (press): Enter, Escape, Tab, ArrowDown…' },
      dy: { type: 'number', description: 'Píxeles de scroll (positivo = abajo). Default 600.' },
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
