// src/browser/__tests__/kage_e2e.test.ts
// E2E hermético del subsistema Kage: ejercita la cadena real observe → act →
// verify contra un DOM REAL (Chromium headless de Playwright) usando una página
// fixture en memoria. No abre ventana, no toca el Chrome del usuario ni la red.
// Cubre: observer.snapshot (refs, flag sensitive), actor.act (type/click/link),
// verifier.buildVerdict (señales DOM/URL) y consent.isSensitive.
// Backlog Kage #2 (docs/BROWSER_SUBSYSTEM.md §7).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { snapshot } from '../observer.js';
import { act } from '../actor.js';
import { isSensitive } from '../consent.js';
import type { KageSession } from '../session.js';
import type { ElementRef } from '../types.js';

// Página de prueba: un input de texto, un password (sensible), un botón que muta
// el DOM por onclick, un link con hash (cambia la URL) y un submit etiquetado.
const FIXTURE = `<!doctype html><html><body>
  <input id="q" type="text" placeholder="Buscar" />
  <input id="pw" type="password" name="password" placeholder="Contraseña" />
  <button id="show" onclick="document.body.appendChild(Object.assign(document.createElement('div'),{textContent:'nuevo'}))">Mostrar</button>
  <a id="go" href="#done">Ir a la sección</a>
  <button id="submit" type="submit">Enviar</button>
</body></html>`;

// Sesión mínima: el actor solo necesita getPage/getCDP/lock/unlock. Sin CDP el
// input-lock degrada a no-op, igual que en producción sin Chromium-CDP.
function fakeSession(page: Page): KageSession {
  return {
    getPage: async () => page,
    getCDP: () => null,
    lockInput: async () => {},
    unlockInput: async () => {},
    lastElements: [] as ElementRef[],
    knownHosts: new Set<string>(),
    rememberHost: () => {},
  } as unknown as KageSession;
}

let browser: Browser;
let page: Page;

describe('Kage E2E (observe → act → verify)', () => {
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.setContent(FIXTURE, { waitUntil: 'domcontentloaded' });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  it('observe descubre los interactivos con refs y marca el password como sensible', async () => {
    const snap = await snapshot(page);
    // 5 interactivos visibles (2 inputs, 2 botones, 1 link).
    expect(snap.elements.length).toBe(5);
    // refs consecutivos desde 1.
    expect(snap.elements.map(e => e.ref)).toEqual([1, 2, 3, 4, 5]);

    const pw = snap.elements.find(e => e.role === 'input' && e.hint === 'password');
    expect(pw, 'debe detectar el input password').toBeTruthy();
    expect(pw!.sensitive).toBe(true);

    const link = snap.elements.find(e => e.role === 'link');
    expect(link?.label).toContain('Ir a la sección');
  });

  it('act type escribe en el input y el valor queda en el DOM', async () => {
    const snap = await snapshot(page);
    const q = snap.elements.find(e => e.label === 'Buscar')!;
    const res = await act(fakeSession(page), { action: 'type', ref: q.ref, text: 'hola kage' });
    expect(res.ok).toBe(true);
    expect(await page.inputValue('#q')).toBe('hola kage');
  });

  it('act click sobre un botón que muta el DOM queda VERIFICADO por mutación', async () => {
    const snap = await snapshot(page);
    const show = snap.elements.find(e => e.label === 'Mostrar')!;
    const res = await act(fakeSession(page), { action: 'click', ref: show.ref });
    expect(res.ok).toBe(true);
    expect(res.verdict.verified).toBe(true);
    expect(res.verdict.why).toMatch(/DOM|elemento objetivo|pantalla/i);
  });

  it('act click sobre un link queda VERIFICADO por cambio de URL', async () => {
    const snap = await snapshot(page);
    const go = snap.elements.find(e => e.role === 'link')!;
    const res = await act(fakeSession(page), { action: 'click', ref: go.ref, reobserve: true });
    expect(res.ok).toBe(true);
    expect(res.verdict.verified).toBe(true);
    expect(page.url()).toContain('#done');
    // reobserve devuelve un snapshot fresco.
    expect(res.snapshot?.elements.length).toBe(5);
  });

  it('act sobre un ref inexistente falla con mensaje claro (staleness)', async () => {
    const res = await act(fakeSession(page), { action: 'click', ref: 9999 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no existe|no encontrado|vuelve a observar/i);
  });

  it('consent marca como sensible escribir en password y pulsar Enviar', async () => {
    const snap = await snapshot(page);
    const pw = snap.elements.find(e => e.hint === 'password')!;
    const submit = snap.elements.find(e => e.label === 'Enviar')!;

    expect(isSensitive({ action: 'type', ref: pw.ref, text: 'x' }, pw).sensitive).toBe(true);
    expect(isSensitive({ action: 'click', ref: submit.ref }, submit).sensitive).toBe(true);
    // navegar a un host no visto antes también es sensible.
    const nav = isSensitive({ action: 'navigate', url: 'https://nuevo.example' }, undefined, new Set());
    expect(nav.sensitive).toBe(true);
  });
});
