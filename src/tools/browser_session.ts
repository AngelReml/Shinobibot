// src/tools/browser_session.ts
// Tool de ciclo de vida: open/close/status/navigate y control del screencast.
// Ver docs/BROWSER_SUBSYSTEM.md §3.

import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { kageSession } from '../browser/session.js';
import { screencastHub } from '../browser/screencast.js';
import { requestBrowserConsent } from '../browser/consent.js';
import type { KageSession } from '../browser/session.js';

/**
 * Pide consentimiento para navegar a `url` (mismo gate que browser_act): con
 * KAGE_CONSENT=sensitive pregunta si el host no se ha visto en esta sesión.
 * Devuelve null si está permitido, o un ToolResult de error si se deniega.
 */
async function consentForNavigate(session: KageSession, url: string): Promise<ToolResult | null> {
  const consent = await requestBrowserConsent({ action: 'navigate', url }, undefined, session.knownHosts);
  if (!consent.allowed) {
    return { success: false, output: '', error: `Navegación no permitida (${consent.reason}). No se navegó.` };
  }
  return null;
}

const browserSession: Tool = {
  name: 'browser_session',
  description:
    'Gestiona la sesión de navegador de Shinobi: open (conecta/abre), navigate ' +
    '(ir a una URL), status (estado actual), screencast_on/screencast_off ' +
    '(retransmisión en vivo al panel), close (suelta la sesión sin cerrar tu ' +
    'navegador). Úsala para arrancar antes de observar/actuar.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['open', 'navigate', 'status', 'screencast_on', 'screencast_off', 'close'],
        description: 'Operación de sesión.',
      },
      url: { type: 'string', description: 'URL para action=navigate u open.' },
    },
    required: ['action'],
  },
  categories: ['research'],

  async execute(args: { action: string; url?: string }): Promise<ToolResult> {
    try {
      const session = kageSession();
      switch (args.action) {
        case 'open': {
          const page = await session.getPage();
          if (args.url) {
            const denied = await consentForNavigate(session, args.url);
            if (denied) return denied;
            await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          }
          session.rememberHost();
          if ((process.env.KAGE_SCREENCAST || 'on') !== 'off') {
            await screencastHub().start(session);
          }
          return { success: true, output: `Sesión de navegador lista. URL: ${session.status().url ?? '(en blanco)'}.` };
        }
        case 'navigate': {
          if (!args.url) return { success: false, output: '', error: 'navigate requiere url.' };
          const page = await session.getPage();
          const denied = await consentForNavigate(session, args.url);
          if (denied) return denied;
          await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          session.rememberHost();
          return { success: true, output: `Navegó a ${args.url}.` };
        }
        case 'status': {
          const s = session.status();
          return { success: true, output: `connected=${s.connected} url=${s.url ?? '-'} input_locked=${s.locked} screencast=${screencastHub().isActive()}` };
        }
        case 'screencast_on': {
          const r = await screencastHub().start(session);
          return r.ok
            ? { success: true, output: 'Screencast activado.' }
            : { success: false, output: '', error: r.error };
        }
        case 'screencast_off': {
          await screencastHub().stop(session);
          return { success: true, output: 'Screencast detenido.' };
        }
        case 'close': {
          await screencastHub().stop(session);
          await session.detach();
          return { success: true, output: 'Sesión soltada (tu navegador sigue abierto).' };
        }
        default:
          return { success: false, output: '', error: `acción desconocida: ${args.action}` };
      }
    } catch (err: any) {
      return { success: false, output: '', error: err?.message ?? String(err) };
    }
  },
};

registerTool(browserSession);
export default browserSession;
