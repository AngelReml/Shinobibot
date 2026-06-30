// src/browser/actor.ts
// Mejora 2: acción anclada con Playwright + reintento por staleness; CDP solo de
// respaldo (click_xy). Mejora 3: cada acción devuelve un veredicto de
// verificación. Mejora 4: input-lock del motor durante la acción.
// G4-1: nuevas acciones back/forward/wait_for/upload/iframe; resolveRef usa
// resolveRefDeep para piercear shadow roots; act opera sobre el contexto activo
// (page o frame) vía session.getActiveContext().
// Ver docs/BROWSER_SUBSYSTEM.md §1 (Mejoras 2-4).

import type { Page, Frame } from 'playwright';
import type { KageSession } from './session.js';
import type { ActCommand, ActResult } from './types.js';
import { snapshot, resolveRefDeep } from './observer.js';
import { startMutationCounter, captureBefore, buildVerdict } from './verifier.js';

/**
 * Resuelve un ref en el contexto activo (page o frame), atravesando shadow roots.
 * Reintenta una vez después de re-observar si la primera búsqueda falla.
 */
async function resolveRef(ctx: Page | Frame, ref: number, retryObserve = false) {
  const handle = await resolveRefDeep(ctx, ref);
  if (handle) return handle;
  if (!retryObserve) return null;
  // staleness: re-observa y reintenta.
  await snapshot(ctx);
  return resolveRefDeep(ctx, ref);
}

/**
 * Ejecuta una acción. Envuelve todo en lock/unlock de entrada (finally) y mide
 * señales de verificación. Reintenta una vez ante staleness re-observando.
 */
export async function act(session: KageSession, cmd: ActCommand): Promise<ActResult> {
  const page = await session.getPage();
  const ctx = await session.getActiveContext();

  const before = await captureBefore(page);
  const readMutations = await startMutationCounter(page);
  let targetDetached = false;
  let detail = '';

  await session.lockInput();
  try {
    switch (cmd.action) {
      // ── Navegación de página completa ─────────────────────────────────────
      case 'navigate': {
        if (!cmd.url) throw new Error('navigate requiere url');
        await page.goto(cmd.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        session.setActiveFrame(null); // nueva URL = vuelve a página principal
        detail = `navegó a ${cmd.url}`;
        break;
      }
      case 'back': {
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15_000 });
        session.setActiveFrame(null);
        detail = 'navegó hacia atrás';
        break;
      }
      case 'forward': {
        await page.goForward({ waitUntil: 'domcontentloaded', timeout: 15_000 });
        session.setActiveFrame(null);
        detail = 'navegó hacia adelante';
        break;
      }

      // ── Espera explícita ───────────────────────────────────────────────────
      case 'wait_for': {
        const ms = cmd.timeout ?? 15_000;
        if (cmd.selector) {
          await ctx.waitForSelector(cmd.selector, { state: 'visible', timeout: ms });
          detail = `esperó selector "${cmd.selector}"`;
        } else {
          // Espera estabilización de red (solo disponible en Page).
          const asPage = ctx as any;
          if (typeof asPage.waitForLoadState === 'function') {
            await asPage.waitForLoadState('networkidle', { timeout: ms });
          } else {
            await ctx.waitForTimeout(Math.min(ms, 3_000));
          }
          detail = 'esperó estabilización';
        }
        break;
      }

      // ── Scroll ────────────────────────────────────────────────────────────
      case 'scroll': {
        const dy = cmd.dy ?? 600;
        const cycles = Math.max(1, cmd.scroll_count ?? 1);
        const waitBetween = cmd.wait_between_ms ?? 1_500;
        for (let i = 0; i < cycles; i++) {
          await (ctx as Page).evaluate((px: number) => { window.scrollBy(0, px); }, dy);
          if (i < cycles - 1) await (ctx as Page).waitForTimeout(waitBetween);
        }
        detail = cycles > 1 ? `scroll ${dy}px × ${cycles} ciclos` : `scroll ${dy}px`;
        break;
      }

      // ── Teclado global ────────────────────────────────────────────────────
      case 'press': {
        if (!cmd.key) throw new Error('press requiere key');
        if (cmd.ref != null) {
          const h = await resolveRef(ctx, cmd.ref, true);
          if (!h) throw new Error(`ref ${cmd.ref} no encontrado`);
          await h.press(cmd.key, { timeout: 10_000 });
        } else {
          await page.keyboard.press(cmd.key);
        }
        detail = `tecla ${cmd.key}`;
        break;
      }

      // ── Click crudo por coordenadas (canvas/WebGL fallback) ───────────────
      case 'click_xy': {
        if (cmd.x == null || cmd.y == null) throw new Error('click_xy requiere x e y');
        const cdp = session.getCDP();
        if (cdp) {
          await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cmd.x, y: cmd.y, button: 'left', clickCount: 1 });
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cmd.x, y: cmd.y, button: 'left', clickCount: 1 });
        } else {
          await page.mouse.click(cmd.x, cmd.y);
        }
        detail = `click crudo en (${cmd.x},${cmd.y})`;
        break;
      }

      // ── Upload ────────────────────────────────────────────────────────────
      case 'upload': {
        if (cmd.ref == null) throw new Error('upload requiere ref');
        if (!cmd.files || cmd.files.length === 0) throw new Error('upload requiere files[]');
        const h = await resolveRef(ctx, cmd.ref, true);
        if (!h) throw new Error(`ref ${cmd.ref} no existe (upload)`);
        await (h as any).setInputFiles(cmd.files, { timeout: 10_000 });
        targetDetached = true; // el input de archivos puede desconectarse tras setInputFiles
        detail = `subió ${cmd.files.length} archivo(s) en ref ${cmd.ref}`;
        break;
      }

      // ── Iframe ────────────────────────────────────────────────────────────
      case 'iframe': {
        const frames: Frame[] = page.frames();
        // frames[0] es la página principal; los iframes empiezan en frames[1].
        let frame: Frame | undefined;
        if (cmd.src != null) {
          frame = frames.find(f => f.url().includes(cmd.src!));
        } else {
          const idx = (cmd.index ?? 0) + 1; // +1 para saltar la página principal
          frame = frames[idx];
        }
        if (!frame || frame.isDetached()) {
          throw new Error(`iframe no encontrado (src="${cmd.src ?? ''}", index=${cmd.index ?? 0})`);
        }
        session.setActiveFrame(frame);
        detail = `cambió contexto a iframe "${frame.url() || '(sin URL)'}"`;
        break;
      }

      // ── Acciones ancladas por ref (click / type / select) ─────────────────
      case 'click':
      case 'type':
      case 'select': {
        if (cmd.action === 'click' && cmd.ref == null) {
          // Selector fallback: clic sin ref previo (sin necesidad de browser_observe)
          const p = ctx as Page;
          const nthIdx = Math.max(0, (cmd.nth ?? 1) - 1); // nth es 1-indexed para el LLM
          if (cmd.css_selector) {
            await p.locator(cmd.css_selector).nth(nthIdx).click({ timeout: 10_000 });
            detail = `click por css "${cmd.css_selector}"${nthIdx > 0 ? `[${nthIdx + 1}]` : ''}`;
          } else if (cmd.aria_label) {
            await p.locator(`[aria-label*="${cmd.aria_label}" i]`).nth(nthIdx).click({ timeout: 10_000 });
            detail = `click por aria-label "${cmd.aria_label}"`;
          } else if (cmd.button_text) {
            await p.getByText(cmd.button_text, { exact: false }).nth(nthIdx).click({ timeout: 10_000 });
            detail = `click por texto "${cmd.button_text}"`;
          } else {
            throw new Error('click requiere ref, css_selector, aria_label o button_text');
          }
          targetDetached = true; // el click puede causar navegación
          break;
        }

        if (cmd.ref == null) throw new Error(`${cmd.action} requiere ref`);
        const handle = await resolveRef(ctx, cmd.ref, true);
        if (!handle) throw new Error(`ref ${cmd.ref} no existe (página cambió; vuelve a observar)`);

        if (cmd.action === 'click') {
          await handle.click({ timeout: 10_000 });
          detail = `click en ref ${cmd.ref}`;
        } else if (cmd.action === 'type') {
          if (cmd.text == null) throw new Error('type requiere text');
          await handle.fill(cmd.text, { timeout: 10_000 });
          detail = `escribió ${cmd.text.length} chars en ref ${cmd.ref}`;
        } else {
          if (cmd.text == null) throw new Error('select requiere text (valor/label)');
          await (handle as any).selectOption({ label: cmd.text }).catch(async () => {
            await (handle as any).selectOption(cmd.text);
          });
          detail = `seleccionó "${cmd.text}" en ref ${cmd.ref}`;
        }

        try {
          targetDetached = !(await (handle as any).evaluate((el: any) => el.isConnected));
        } catch {
          targetDetached = true;
        }
        break;
      }

      default:
        throw new Error(`acción desconocida: ${(cmd as any).action}`);
    }

    await page.waitForTimeout(400);
    const domMutations = await readMutations();
    const { verdict } = await buildVerdict(page, before, domMutations, targetDetached);

    const result: ActResult = { ok: true, action: cmd.action, detail, verdict };
    if (cmd.reobserve) {
      result.snapshot = await snapshot(ctx);
    }
    return result;
  } catch (err: any) {
    return {
      ok: false,
      action: cmd.action,
      detail,
      verdict: { verified: false, why: 'la acción lanzó error antes de completarse' },
      error: err?.message ?? String(err),
    };
  } finally {
    await session.unlockInput();
  }
}
