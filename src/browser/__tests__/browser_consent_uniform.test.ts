// F1.3 (RANK #4) — dos rutas de navegación con distinto nivel de consent
// gate: browser_session/browser_act ya pasaban por requestBrowserConsent(),
// pero web_search/web_search_with_warmup/clean_extract navegaban directo por
// CDP sin NINGÚN gate — un agente podía evitar el consentimiento simplemente
// usando una de esas tres tools. La fix añadió requestNavigationConsent()
// (wrapper sobre requestBrowserConsent que comparte kageSession().knownHosts)
// y lo enganchó en las tres. Este test verifica, por comportamiento real
// (no por lectura de código), que las 4 tools de navegación paran en el
// gate antes de conectar/navegar.
//
// Nota técnica: usamos vi.mock (no vi.spyOn sobre el namespace importado en
// el test) porque el transform de Vite resuelve imports nombrados a
// referencias directas — spyOn sobre el objeto importado aquí NO intercepta
// llamadas hechas por otros módulos que importaron la función por su cuenta.
// vi.mock sí opera a nivel de resolución de módulo y por tanto es visible
// para cualquier importador. Además: requestNavigationConsent() llama
// internamente a requestBrowserConsent() dentro del MISMO módulo consent.ts
// (una llamada intra-módulo no es interceptable ni con vi.mock), así que
// cada tool se comprueba contra la función pública que REALMENTE invoca:
// browser_session → requestBrowserConsent; las otras tres → requestNavigationConsent.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../consent.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../consent.js')>();
  return {
    ...actual,
    requestBrowserConsent: vi.fn(actual.requestBrowserConsent),
    requestNavigationConsent: vi.fn(actual.requestNavigationConsent),
  };
});

import * as consentModule from '../consent.js';
import { KageSession } from '../session.js';

const browserConsentSpy = vi.mocked(consentModule.requestBrowserConsent);
const navigationConsentSpy = vi.mocked(consentModule.requestNavigationConsent);

const NAVIGATION_TOOLS = [
  {
    name: 'browser_session.js (action=navigate)',
    module: '../../tools/browser_session.js',
    spy: () => browserConsentSpy,
    invoke: async (tool: any) => tool.execute({ action: 'navigate', url: 'https://example.com' }),
  },
  {
    name: 'web_search.js',
    module: '../../tools/web_search.js',
    spy: () => navigationConsentSpy,
    invoke: async (tool: any) => tool.execute({ query: 'https://example.com' }),
  },
  {
    name: 'web_search_with_warmup.js',
    module: '../../tools/web_search_with_warmup.js',
    spy: () => navigationConsentSpy,
    invoke: async (tool: any) => tool.execute({ query: 'https://example.com' }),
  },
  {
    name: 'clean_extract.js',
    module: '../../tools/clean_extract.js',
    spy: () => navigationConsentSpy,
    invoke: async (tool: any) => tool.execute({ url: 'https://example.com' }),
  },
];

describe('F1.3 — todas las tools de navegación pasan por el gate de consentimiento antes de navegar', () => {
  let getPageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.KAGE_CONSENT = 'all'; // fail-closed sin asker registrado (F4.5)
    browserConsentSpy.mockClear();
    navigationConsentSpy.mockClear();
    // browser_session.js llama a session.getPage() ANTES del gate para
    // obtener/crear la página activa (no es navegación en sí — el goto()
    // real ocurre DESPUÉS del gate). En este entorno de test no hay CDP
    // real, así que stubbeamos getPage() para poder llegar al gate y
    // observar la invocación, igual que en producción con browser real.
    getPageSpy = vi.spyOn(KageSession.prototype, 'getPage').mockResolvedValue({} as any);
  });

  afterEach(() => {
    delete process.env.KAGE_CONSENT;
    getPageSpy.mockRestore();
  });

  for (const t of NAVIGATION_TOOLS) {
    it(`${t.name} invoca el gate de consentimiento antes de la primera navegación`, async () => {
      const mod = await import(t.module);
      const tool = mod.default;
      const result = await t.invoke(tool);
      const spy = t.spy();
      expect(spy).toHaveBeenCalled();
      // fail-closed (F4.5): KAGE_CONSENT=all sin asker ⇒ denegado, la
      // navegación real nunca debió ocurrir.
      expect(result.success).toBe(false);
    });
  }
});
