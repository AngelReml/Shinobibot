// src/browser/session.ts
// Singleton KageSession: mantiene UNA pestaña activa, su CDPSession, el lock de
// entrada y el ciclo de vida. Reutiliza connectOrLaunchCDP() de browser_cdp.ts
// para respetar los modos sandbox / CDP-remoto / local ya existentes.
// Ver docs/BROWSER_SUBSYSTEM.md §2.

import type { Browser, BrowserContext, Page, CDPSession } from 'playwright';
import type { ElementRef } from './types.js';

export class KageSession {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private cdp: CDPSession | null = null;
  private inputLocked = false;

  /** Último mapa de elementos observado (para resolver ref→ElementRef en consent). */
  lastElements: ElementRef[] = [];
  /** Hosts ya visitados en esta sesión (para detectar navegación nueva). */
  readonly knownHosts: Set<string> = new Set();

  /** Registra el host actual como conocido. */
  rememberHost(): void {
    try {
      if (this.page && !this.page.isClosed()) {
        const h = new URL(this.page.url()).host;
        if (h) this.knownHosts.add(h);
      }
    } catch { /* url no parseable */ }
  }

  /** Conecta (o reutiliza) y deja una pestaña activa lista. */
  async ensure(): Promise<void> {
    if (this.browser && this.page && !this.page.isClosed()) return;

    const { connectOrLaunchCDP } = await import('../tools/browser_cdp.js');
    this.browser = await connectOrLaunchCDP();

    // Reutiliza un contexto/página existente del usuario si lo hay; si no, crea.
    const contexts = this.browser.contexts();
    let ctx: BrowserContext | undefined = contexts[0];
    if (!ctx) ctx = await this.browser.newContext();

    // FIX (batería 2026-06-10): inyecta un `__name` identidad en CADA documento
    // que cargue este contexto, de forma que cualquier page.evaluate del
    // subsistema (observer/actor/verifier) que serialice funciones nombradas
    // envueltas por el bundler no reviente con "ReferenceError: __name is not
    // defined". addInitScript cubre navegaciones futuras; observer.ts además lo
    // inyecta inline para la página ya cargada. Best-effort: si falla, seguimos.
    try {
      await ctx.addInitScript(() => {
        const g = globalThis as any;
        if (typeof g.__name !== 'function') g.__name = (fn: any) => fn;
      });
    } catch { /* contexto sin soporte: observer.ts tiene el fallback inline */ }

    const pages = ctx.pages();
    this.page = pages.length > 0 ? pages[pages.length - 1] : await ctx.newPage();

    // CDPSession para input-lock y screencast (capacidades fuera de la API alta
    // de Playwright). newCDPSession funciona en Chromium conectado por CDP.
    try {
      this.cdp = await ctx.newCDPSession(this.page);
    } catch {
      this.cdp = null; // sin CDP seguimos: input-lock y screencast se degradan.
    }
  }

  /** Devuelve la página activa (la crea si hace falta). */
  async getPage(): Promise<Page> {
    await this.ensure();
    if (!this.page) throw new Error('KageSession: no hay página activa.');
    return this.page;
  }

  /** Devuelve la CDPSession o null si no está disponible. */
  getCDP(): CDPSession | null {
    return this.cdp;
  }

  /**
   * Bloquea la entrada física del usuario en el motor durante una acción del
   * agente (Mejora 4). Best-effort: si no hay CDP, no-op. SIEMPRE liberar con
   * unlockInput en un finally.
   */
  async lockInput(): Promise<void> {
    if (!this.cdp || this.inputLocked) return;
    try {
      await this.cdp.send('Input.setIgnoreInputEvents', { ignore: true });
      this.inputLocked = true;
    } catch { /* degradación silenciosa */ }
  }

  async unlockInput(): Promise<void> {
    if (!this.cdp || !this.inputLocked) return;
    try {
      await this.cdp.send('Input.setIgnoreInputEvents', { ignore: false });
    } catch { /* ignore */ }
    this.inputLocked = false;
  }

  /** Cambia la pestaña activa a la que matchee una subcadena de URL. */
  async focusTabByUrl(urlContains: string): Promise<boolean> {
    if (!this.browser) return false;
    const all = this.browser.contexts().flatMap(c => c.pages());
    const found = all.find(p => p.url().toLowerCase().includes(urlContains.toLowerCase()));
    if (!found) return false;
    this.page = found;
    const ctx = found.context();
    try { this.cdp = await ctx.newCDPSession(found); } catch { this.cdp = null; }
    await found.bringToFront().catch(() => {});
    return true;
  }

  status(): { connected: boolean; url: string | null; locked: boolean } {
    return {
      connected: !!(this.page && !this.page.isClosed()),
      url: this.page && !this.page.isClosed() ? this.page.url() : null,
      locked: this.inputLocked,
    };
  }

  /** Suelta la CDPSession y olvida la página. NO cierra el navegador del usuario. */
  async detach(): Promise<void> {
    await this.unlockInput();
    if (this.cdp) { try { await this.cdp.detach(); } catch { /* ignore */ } }
    this.cdp = null;
    this.page = null;
    this.browser = null;
  }
}

let _session: KageSession | null = null;

/** Singleton perezoso. */
export function kageSession(): KageSession {
  if (!_session) _session = new KageSession();
  return _session;
}

/** Para tests: descarta el singleton. */
export function _resetKageSession(): void {
  _session = null;
}
