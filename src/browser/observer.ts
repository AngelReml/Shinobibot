// src/browser/observer.ts
// Mejora 1: observación por mapa de elementos con ref estable.
// Recorre el DOM en el contexto de la página, detecta interactivos VISIBLES,
// les pone data-kage-ref="N" y devuelve una lista numerada legible para el LLM.
// Ver docs/BROWSER_SUBSYSTEM.md §1 (Mejora 1) y §2.

import type { Page } from 'playwright';
import type { ElementRef, Snapshot } from './types.js';

// Este módulo evalúa código DENTRO del navegador (page.evaluate). El proyecto
// es Node y no incluye la lib DOM, así que declaramos los globales del DOM como
// `any` solo para este archivo. No afecta al runtime: el cuerpo de la función
// corre en la página, no en Node.
declare const document: any;
declare const window: any;

/**
 * Script que se evalúa DENTRO de la página. Debe ser autocontenido (no usa
 * nada del scope de Node). Devuelve un array serializable de elementos.
 */
function collectInteractiveElements(): Array<{
  ref: number; label: string; role: string; hint?: string; sensitive?: boolean;
}> {
  // Limpia tags previos para que los refs no se solapen entre snapshots.
  document.querySelectorAll('[data-kage-ref]').forEach((el: any) => el.removeAttribute('data-kage-ref'));

  const out: Array<{ ref: number; label: string; role: string; hint?: string; sensitive?: boolean }> = [];
  let ref = 0;

  const isVisible = (el: any): boolean => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    // dentro (o cerca) del viewport vertical extendido
    if (r.bottom < -50 || r.top > (window.innerHeight || 0) + 1000) return false;
    return true;
  };

  const roleOf = (el: any): string => {
    const tag = el.tagName.toLowerCase();
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'submit' || t === 'button') return 'button';
      return 'input';
    }
    return 'clickable';
  };

  const labelOf = (el: any): string => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const ph = el.getAttribute('placeholder');
    if (ph && ph.trim()) return ph.trim();
    const val = el.value;
    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (txt) return txt.slice(0, 80);
    if (val && typeof val === 'string' && val.trim()) return val.trim().slice(0, 80);
    const name = el.getAttribute('name');
    if (name) return name;
    const title = el.getAttribute('title');
    if (title) return title.trim();
    return '(sin etiqueta)';
  };

  const selector = [
    'a[href]', 'button', 'input', 'select', 'textarea',
    '[role=button]', '[role=link]', '[role=tab]', '[role=menuitem]',
    '[onclick]', '[contenteditable=true]',
  ].join(',');

  const candidates: any[] = Array.from(document.querySelectorAll(selector));
  for (const el of candidates) {
    if (!isVisible(el)) continue;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'input' && type === 'hidden') continue;

    ref += 1;
    el.setAttribute('data-kage-ref', String(ref));
    const role = roleOf(el);
    const hint = tag === 'input' ? (type || 'text') : (type || undefined);
    const sensitive =
      type === 'password' ||
      /pass|contrase|card|tarjeta|cvv|iban|secret|token/i.test(
        (el.getAttribute('name') || '') + (el.getAttribute('autocomplete') || '') + labelOf(el)
      );
    out.push({ ref, label: labelOf(el), role, hint, sensitive });
  }
  return out;
}

/** Formatea los elementos como texto legible para el LLM. */
function formatElements(elements: ElementRef[]): string {
  if (elements.length === 0) return '(no se detectaron elementos interactivos visibles)';
  return elements
    .map(e => {
      const h = e.hint ? `  (${e.hint})` : '';
      const s = e.sensitive ? '  🔒sensitive' : '';
      return `[${e.ref}] ${e.role} "${e.label}"${h}${s}`;
    })
    .join('\n');
}

/**
 * Observa la pestaña activa. `withScreenshot` añade un jpeg reducido en base64.
 */
export async function snapshot(page: Page, withScreenshot = false): Promise<Snapshot> {
  // FIX (batería 2026-06-10): el bundler (esbuild/tsup keepNames) envuelve las
  // funciones nombradas (`collectInteractiveElements` y sus helpers internos
  // `isVisible`/`roleOf`/`labelOf`) en `__name(fn, "nombre")` para preservar
  // `.name`. Al serializar la función a la página vía page.evaluate, esas
  // llamadas a `__name` viajan en el string pero el helper NO existe en el
  // contexto de la página → `ReferenceError: __name is not defined` y
  // browser_observe quedaba completamente roto. Inyectamos un `__name`
  // identidad en la página ANTES de evaluar. La arrow anónima inline de abajo
  // NO la envuelve el bundler (solo nombra funciones con nombre), así que esta
  // inyección es segura y no recae en el mismo bug.
  await page.evaluate(() => {
    const g = globalThis as any;
    if (typeof g.__name !== 'function') g.__name = (fn: any) => fn;
  });
  const elements = (await page.evaluate(collectInteractiveElements)) as ElementRef[];
  const url = page.url();
  const title = await page.title().catch(() => '');

  let screenshotB64: string | undefined;
  if (withScreenshot) {
    try {
      const buf = await page.screenshot({ type: 'jpeg', quality: 50, fullPage: false });
      screenshotB64 = buf.toString('base64');
    } catch { /* sin screenshot si falla */ }
  }

  const text = [
    `URL: ${url}`,
    `Título: ${title}`,
    `Elementos interactivos (${elements.length}):`,
    formatElements(elements),
  ].join('\n');

  return { url, title, elements, text, screenshotB64 };
}
