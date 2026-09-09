// src/browser/__tests__/kage_g4.test.ts
// G4-1 — Kage robusto: tests para los 5 operadores nuevos (back, forward,
// wait_for, upload, iframe) y para la observación de shadow DOM.
// Todos corren contra Chromium headless, sin red, sin Chrome del usuario.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { snapshot } from '../observer.js';
import { act } from '../actor.js';
import type { KageSession } from '../session.js';
import type { ElementRef } from '../types.js';
import type { Frame } from 'playwright';
import { chromiumAvailable, chromiumSkipReason } from './_playwright_available.js';

// ── Fixture pages ───────────────────────────────────────────────────────────

const PAGE_A = `<!doctype html><html><body>
  <p>Página A</p>
  <a id="go" href="about:blank">Ir a blank</a>
</body></html>`;

const PAGE_SHADOW = `<!doctype html><html><body>
  <div id="host"></div>
  <script>
    const host = document.getElementById('host');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<button id="sb">Shadow button</button><input id="si" type="text" placeholder="Shadow input" />';
  </script>
</body></html>`;

const PAGE_UPLOAD = `<!doctype html><html><body>
  <input id="file" type="file" />
  <p id="out">sin archivo</p>
  <script>
    document.getElementById('file').addEventListener('change', function() {
      document.getElementById('out').textContent = this.files[0]?.name ?? 'ninguno';
    });
  </script>
</body></html>`;

const PAGE_IFRAME = `<!doctype html><html><body>
  <p>Página principal</p>
  <iframe id="f1" src="about:blank" width="400" height="200"></iframe>
</body></html>`;

const PAGE_WAIT = `<!doctype html><html><body>
  <p id="static">estático</p>
  <script>
    setTimeout(() => {
      const d = document.createElement('div');
      d.id = 'late'; d.textContent = 'aparecido tarde';
      document.body.appendChild(d);
    }, 300);
  </script>
</body></html>`;

// ── Fake session ─────────────────────────────────────────────────────────────

function fakeSession(page: Page): KageSession {
  let activeFrame: Frame | null = null;
  return {
    getPage: async () => page,
    getCDP: () => null,
    lockInput: async () => {},
    unlockInput: async () => {},
    lastElements: [] as ElementRef[],
    knownHosts: new Set<string>(),
    rememberHost: () => {},
    setActiveFrame: (f: Frame | null) => { activeFrame = f; },
    getActiveContext: async () => activeFrame && !activeFrame.isDetached() ? activeFrame : page,
  } as unknown as KageSession;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

let browser: Browser;
let page: Page;

// ── Tests ────────────────────────────────────────────────────────────────────

if (!chromiumAvailable) console.warn(`[kage_g4] SKIP — ${chromiumSkipReason}`);
// Gate explícito: sin el navegador de Playwright estos E2E se saltan (no fallan).
const suite = chromiumAvailable ? describe : describe.skip;

suite('G4-1 Kage robusto', () => {
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  it('back y forward navegan el historial', async () => {
    // Navega a A → blank → back → forward
    await page.setContent(PAGE_A, { waitUntil: 'domcontentloaded' });
    const urlA = page.url();

    // Simula click en el enlace (navega a about:blank)
    await page.click('#go');
    expect(page.url()).toContain('about:blank');

    const session = fakeSession(page);

    // back
    const rb = await act(session, { action: 'back' });
    expect(rb.ok).toBe(true);
    expect(rb.detail).toContain('atrás');
    expect(page.url()).toBe(urlA);

    // forward
    const rf = await act(session, { action: 'forward' });
    expect(rf.ok).toBe(true);
    expect(rf.detail).toContain('adelante');
    expect(page.url()).toContain('about:blank');
  }, 30_000);

  it('wait_for espera un selector que aparece dinámicamente', async () => {
    await page.setContent(PAGE_WAIT, { waitUntil: 'domcontentloaded' });
    const session = fakeSession(page);

    // El elemento #late aparece en ~300 ms.
    const r = await act(session, { action: 'wait_for', selector: '#late', timeout: 5_000 });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('#late');
    const text = await page.$eval('#late', (el: any) => el.textContent);
    expect(text).toBe('aparecido tarde');
  }, 15_000);

  it('upload asigna archivos a un input[type=file]', async () => {
    await page.setContent(PAGE_UPLOAD, { waitUntil: 'domcontentloaded' });
    const session = fakeSession(page);

    // Observar para asignar refs.
    await snapshot(page);

    // Crear un archivo temporal real.
    const tmpFile = path.join(os.tmpdir(), 'kage_test_upload.txt');
    fs.writeFileSync(tmpFile, 'contenido de prueba');

    try {
      const r = await act(session, { action: 'upload', ref: 1, files: [tmpFile] });
      expect(r.ok).toBe(true);
      expect(r.detail).toContain('1 archivo');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  }, 15_000);

  it('iframe cambia el contexto activo a un frame', async () => {
    await page.setContent(PAGE_IFRAME, { waitUntil: 'domcontentloaded' });

    // Inyectar contenido en el iframe.
    const frames = page.frames();
    const iframe = frames.find(f => f !== page.mainFrame());
    if (iframe) {
      await iframe.evaluate(() => {
        document.open(); document.write('<input type="text" placeholder="dentro del iframe" />'); document.close();
      });
    }

    const session = fakeSession(page);

    // Cambiar contexto al iframe (índice 0).
    const ri = await act(session, { action: 'iframe', index: 0 });
    expect(ri.ok).toBe(true);
    expect(ri.detail).toContain('iframe');

    // Snapshot debe ver elementos del iframe.
    const ctx = await session.getActiveContext();
    const snap = await snapshot(ctx);
    expect(snap.elements.some(e => e.hint === 'text')).toBe(true);
  }, 15_000);

  it('observer piercea shadow DOM y asigna refs a elementos en shadow root', async () => {
    await page.setContent(PAGE_SHADOW, { waitUntil: 'domcontentloaded' });
    // Pequeña espera para que el script inline cree el shadow root.
    await page.waitForTimeout(200);

    const snap = await snapshot(page);

    // Debe detectar el botón y el input dentro del shadow root.
    expect(snap.elements.length).toBeGreaterThanOrEqual(2);
    const roles = snap.elements.map(e => e.role);
    expect(roles).toContain('button');
    expect(roles).toContain('input');
  }, 15_000);

  it('click en elemento dentro de shadow DOM resuelve ref correctamente', async () => {
    // Página fresca para evitar interferencia de rects tras múltiples setContent.
    const freshPage = await browser.newPage();
    try {
      await freshPage.setContent(PAGE_SHADOW, { waitUntil: 'domcontentloaded' });
      await freshPage.waitForTimeout(200);

      const session = fakeSession(freshPage);
      const snap = await snapshot(freshPage);
      const btnRef = snap.elements.find(e => e.role === 'button')?.ref;
      expect(btnRef).toBeDefined();

      const r = await act(session, { action: 'click', ref: btnRef! });
      expect(r.ok).toBe(true);
    } finally {
      await freshPage.close();
    }
  }, 15_000);
});
