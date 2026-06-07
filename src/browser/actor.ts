// src/browser/actor.ts
// Mejora 2: acción anclada con Playwright + reintento por staleness; CDP solo de
// respaldo (click_xy). Mejora 3: cada acción devuelve un veredicto de
// verificación. Mejora 4: input-lock del motor durante la acción.
// Ver docs/BROWSER_SUBSYSTEM.md §1 (Mejoras 2-4).

import type { Page, ElementHandle } from 'playwright';
import type { KageSession } from './session.js';
import type { ActCommand, ActResult } from './types.js';
import { snapshot } from './observer.js';
import { startMutationCounter, captureBefore, buildVerdict } from './verifier.js';

/** Resuelve un ref a un ElementHandle fresco vía el atributo data-kage-ref. */
async function resolveRef(page: Page, ref: number): Promise<ElementHandle | null> {
  const handle = await page.$(`[data-kage-ref="${ref}"]`);
  return handle;
}

/**
 * Ejecuta una acción. Envuelve todo en lock/unlock de entrada (finally) y mide
 * señales de verificación. Reintenta una vez ante staleness re-observando.
 */
export async function act(session: KageSession, cmd: ActCommand): Promise<ActResult> {
  const page = await session.getPage();

  // navigate y scroll no necesitan ref; el resto sí (salvo click_xy/press global).
  const before = await captureBefore(page);
  const readMutations = await startMutationCounter(page);
  let targetDetached = false;
  let detail = '';

  await session.lockInput();
  try {
    switch (cmd.action) {
      case 'navigate': {
        if (!cmd.url) throw new Error('navigate requiere url');
        await page.goto(cmd.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        detail = `navegó a ${cmd.url}`;
        break;
      }
      case 'scroll': {
        const dy = cmd.dy ?? 600;
        await page.evaluate((px: number) => {
          // @ts-ignore — corre en el navegador
          window.scrollBy(0, px);
        }, dy);
        detail = `scroll ${dy}px`;
        break;
      }
      case 'press': {
        if (!cmd.key) throw new Error('press requiere key');
        if (cmd.ref != null) {
          const h = await resolveRef(page, cmd.ref);
          if (!h) throw new Error(`ref ${cmd.ref} no encontrado`);
          await h.press(cmd.key, { timeout: 10_000 });
        } else {
          await page.keyboard.press(cmd.key);
        }
        detail = `tecla ${cmd.key}`;
        break;
      }
      case 'click_xy': {
        // Fallback canvas/WebGL: inyección cruda por CDP. Sin DOM que anclar.
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
      case 'click':
      case 'type':
      case 'select': {
        if (cmd.ref == null) throw new Error(`${cmd.action} requiere ref`);
        let handle = await resolveRef(page, cmd.ref);
        if (!handle) {
          // staleness: re-observa una vez y reintenta resolver.
          await snapshot(page);
          handle = await resolveRef(page, cmd.ref);
          if (!handle) throw new Error(`ref ${cmd.ref} no existe (página cambió; vuelve a observar)`);
        }

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

        // ¿el target sigue conectado? si no, señal fuerte de efecto.
        try {
          targetDetached = !(await handle.evaluate((el: any) => el.isConnected));
        } catch {
          targetDetached = true;
        }
        break;
      }
      default:
        throw new Error(`acción desconocida: ${(cmd as any).action}`);
    }

    // Pequeña espera para que reflows/navegaciones se asienten antes de medir.
    await page.waitForTimeout(400);
    const domMutations = await readMutations();
    const { verdict } = await buildVerdict(page, before, domMutations, targetDetached);

    const result: ActResult = { ok: true, action: cmd.action, detail, verdict };
    if (cmd.reobserve) {
      result.snapshot = await snapshot(page);
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
