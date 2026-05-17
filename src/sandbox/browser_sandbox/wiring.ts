/**
 * Cableado del Sandbox Browser.
 *
 * Con `SHINOBI_BROWSER_SANDBOX=1`, Shinobi automatiza un navegador PROPIO
 * dentro de un contenedor Docker (`docker-compose.sandbox-browser.yml`) en
 * vez de tomar el navegador del usuario.
 *
 * Objetivo de diseño: el usuario conserva sus sesiones logueadas — su
 * Comet/Chrome sigue intacto, no necesita cerrarlo ni arrancarlo con
 * `--remote-debugging-port`. El sandbox aísla el navegador de Shinobi:
 * su propio perfil, su propio CDP, su propia ventana (noVNC).
 *
 * `BrowserSandboxManager` ya envolvía docker compose; aquí se le da un
 * caller de producción: `ensureBrowserSandbox()` lo arranca y espera a
 * que esté sano, y `browser_cdp.connectOrLaunchCDP()` lo consume.
 */

import { BrowserSandboxManager } from './manager.js';

let _started = false;

/** ¿Está activado el modo Sandbox Browser? */
export function browserSandboxEnabled(): boolean {
  return process.env.SHINOBI_BROWSER_SANDBOX === '1';
}

export interface SandboxEnsureResult {
  ok: boolean;
  cdpUrl?: string;
  vncUrl?: string;
  error?: string;
}

/**
 * Arranca el Sandbox Browser (idempotente) y espera a que CDP+noVNC
 * respondan. Devuelve la CDP URL del contenedor para que el cliente CDP
 * se conecte a ÉL, no al navegador del usuario.
 */
export async function ensureBrowserSandbox(
  opts: { timeoutMs?: number; manager?: BrowserSandboxManager } = {},
): Promise<SandboxEnsureResult> {
  const mgr = opts.manager ?? new BrowserSandboxManager();
  if (!mgr.isComposeAvailable()) {
    return { ok: false, error: 'docker-compose.sandbox-browser.yml no encontrado en la raíz del repo' };
  }
  try {
    if (!_started) {
      const up = await mgr.up({ build: false });
      if (up.exitCode !== 0) {
        return { ok: false, error: `docker compose up falló (exit ${up.exitCode}): ${up.stderr.trim() || up.stdout.trim()}` };
      }
      _started = true;
    }
    // Espera a que el contenedor esté sano (CDP + noVNC respondiendo).
    const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
    let health = await mgr.healthCheck();
    while (!health.ok && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      health = await mgr.healthCheck();
    }
    if (!health.ok) {
      return {
        ok: false, cdpUrl: mgr.cdpUrl(), vncUrl: mgr.vncUrl(),
        error: `el sandbox arrancó pero no está sano: ${health.errors.join('; ')}`,
      };
    }
    return { ok: true, cdpUrl: mgr.cdpUrl(), vncUrl: mgr.vncUrl() };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

/** Test helper: reinicia la marca de arranque. */
export function _resetBrowserSandboxWiring(): void { _started = false; }
