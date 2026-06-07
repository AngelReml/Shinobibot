// src/browser/verifier.ts
// Mejora 3: verificación post-acción. Captura señales antes/después de actuar y
// emite un veredicto sobre si la acción tuvo efecto observable.
// Ver docs/BROWSER_SUBSYSTEM.md §1 (Mejora 3).

import type { Page } from 'playwright';
import { createHash } from 'crypto';
import type { VerifySignals, Verdict } from './types.js';

/** Hash corto de un screenshot reducido — barómetro de "cambió la pantalla". */
async function screenHash(page: Page): Promise<string> {
  try {
    const buf = await page.screenshot({ type: 'jpeg', quality: 30, fullPage: false });
    return createHash('sha1').update(buf).digest('hex').slice(0, 16);
  } catch {
    return '';
  }
}

/**
 * Instala un contador de mutaciones del DOM en la página. Devuelve una función
 * que lee el acumulado. Best-effort: si falla, devuelve siempre 0.
 */
export async function startMutationCounter(page: Page): Promise<() => Promise<number>> {
  try {
    await page.evaluate(() => {
      // @ts-ignore — corre en el navegador
      if (window.__kageMut) { window.__kageMut.count = 0; return; }
      // @ts-ignore
      window.__kageMut = { count: 0 };
      // @ts-ignore
      const obs = new MutationObserver((muts) => { window.__kageMut.count += muts.length; });
      // @ts-ignore
      obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    });
  } catch { /* degradación */ }

  return async () => {
    try {
      // @ts-ignore
      return (await page.evaluate(() => (window.__kageMut?.count ?? 0))) as number;
    } catch {
      return 0;
    }
  };
}

/** Captura el estado "antes" de una acción. */
export async function captureBefore(page: Page): Promise<{ url: string; hash: string }> {
  return { url: page.url(), hash: await screenHash(page) };
}

/**
 * Construye señales y veredicto comparando antes/después.
 * `targetDetached` indica que el elemento sobre el que se actuó ya no existe
 * (señal fuerte de navegación o submit exitoso).
 */
export async function buildVerdict(
  page: Page,
  before: { url: string; hash: string },
  domMutations: number,
  targetDetached: boolean,
): Promise<{ signals: VerifySignals; verdict: Verdict }> {
  const urlAfter = page.url();
  const hashAfter = await screenHash(page);

  const signals: VerifySignals = {
    urlBefore: before.url,
    urlAfter,
    domMutations,
    targetDetached,
    screenHashBefore: before.hash,
    screenHashAfter: hashAfter,
  };

  let verified = false;
  let why = 'sin cambios observables tras la acción';

  if (before.url !== urlAfter) {
    verified = true;
    why = `la URL cambió: ${before.url} → ${urlAfter}`;
  } else if (targetDetached) {
    verified = true;
    why = 'el elemento objetivo desapareció (re-render o navegación)';
  } else if (domMutations > 0) {
    verified = true;
    why = `el DOM mutó (${domMutations} cambios)`;
  } else if (before.hash && hashAfter && before.hash !== hashAfter) {
    verified = true;
    why = 'la pantalla cambió (hash de captura distinto)';
  }

  return { signals, verdict: { verified, why } };
}
