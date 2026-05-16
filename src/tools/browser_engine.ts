// src/tools/browser_engine.ts
//
// Bloque 2 — motor central del browser. Centraliza lo que las 6 tools
// individuales repetían inline: page-picker, extracción DOM, formateo de
// estado, anti-detección. Añade capacidades nuevas: accessibility tree,
// screenshot+rotación, clean extract (markdown), vision analyze (opt-in).
//
// Las tools existentes (web_search, browser_click, browser_click_position,
// browser_scroll, web_search_with_warmup) preservan su firma pública y
// llaman al motor por dentro — output byte-idéntico para no romper tests E2E.

import * as fs from 'fs';
import * as path from 'path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { invokeLLMViaOpenRouter } from '../cloud/openrouter_fallback.js';

// ─────────────────────────────────────────────────────────────────────────────
// Page picking
// ─────────────────────────────────────────────────────────────────────────────

export function getActivePage(browser: Browser, urlContains?: string): Page | null {
  const allPages = browser.contexts().flatMap(ctx => ctx.pages());
  if (allPages.length === 0) return null;
  if (urlContains) {
    const needle = urlContains.toLowerCase();
    return allPages.find(p => p.url().toLowerCase().includes(needle)) ?? null;
  }
  return allPages[allPages.length - 1];
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM extraction (preserves output of existing tools verbatim)
// ─────────────────────────────────────────────────────────────────────────────

export interface DomState {
  bodyText: string;
  links: { text: string; href: string }[];
  interactive: { tag: string; role: string; ariaLabel: string; text: string; id: string; name: string }[];
  currentUrl: string;
  title: string;
  finalScrollY?: number;
  finalHeight?: number;
}

export interface ExtractDomOptions {
  /** Max characters of bodyText to keep before "[truncated]" suffix. Default 12000. */
  maxBodyChars?: number;
  /** Max links to return. Default 150. */
  maxLinks?: number;
  /** Max interactive elements to return. Default 80. */
  maxInteractive?: number;
  /** Include scroll metadata. Default false. */
  includeScroll?: boolean;
}

export async function extractDom(page: Page, opts: ExtractDomOptions = {}): Promise<DomState> {
  const maxBodyChars = opts.maxBodyChars ?? 12000;
  const maxLinks = opts.maxLinks ?? 150;
  const maxInteractive = opts.maxInteractive ?? 80;
  const includeScroll = opts.includeScroll ?? false;

  return await page.evaluate(({ maxBodyChars, maxLinks, maxInteractive, includeScroll }: any) => {
    const body = document.body;
    let bodyText = '';
    if (body) {
      bodyText = ((body as any).innerText || '').replace(/\s+/g, ' ').trim();
      if (bodyText.length > maxBodyChars) bodyText = bodyText.slice(0, maxBodyChars) + '...[truncated]';
    }

    const linkNodes = document.querySelectorAll('a[href]');
    const links: any[] = [];
    for (let i = 0; i < linkNodes.length && links.length < maxLinks; i++) {
      const a = linkNodes[i] as any;
      const text = ((a.innerText || a.textContent || '') + '').trim();
      if (text.length > 0) {
        links.push({
          text: text.length > 200 ? text.slice(0, 200) : text,
          href: a.href,
        });
      }
    }

    const interactive: any[] = [];
    const interactiveNodes = document.querySelectorAll('button, input, select, textarea, [role="button"], [role="link"]');
    for (let i = 0; i < interactiveNodes.length && interactive.length < maxInteractive; i++) {
      const el = interactiveNodes[i] as any;
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || '';
      const ariaLabel = el.getAttribute('aria-label') || '';
      let text = ((el.innerText || el.textContent || '') + '').trim();
      if (text.length > 100) text = text.slice(0, 100);
      const id = el.id || '';
      const name = el.getAttribute('name') || '';
      interactive.push({ tag, role, ariaLabel, text, id, name });
    }

    const out: any = {
      bodyText,
      links,
      interactive,
      currentUrl: window.location.href,
      title: document.title,
    };
    if (includeScroll) {
      out.finalScrollY = window.scrollY;
      out.finalHeight = document.documentElement.scrollHeight;
    }
    return out;
  }, { maxBodyChars, maxLinks, maxInteractive, includeScroll });
}

/** Format DomState as the legacy text block shared by web_search / click / scroll. */
export function formatPageState(state: DomState, opts?: { showInteractive?: boolean }): string {
  const showInteractive = opts?.showInteractive ?? true;
  let s = '';
  s += `--- BODY TEXT (${state.bodyText.length} chars) ---\n${state.bodyText}\n`;
  s += `\n--- LINKS (${state.links.length}) ---\n`;
  s += state.links.map((l, i) => `${i + 1}. [${l.text}] -> ${l.href}`).join('\n');
  if (showInteractive) {
    s += `\n\n--- INTERACTIVE ELEMENTS (${state.interactive.length}) ---\n`;
    s += state.interactive
      .map((e, i) =>
        `${i + 1}. <${e.tag}${e.role ? ` role="${e.role}"` : ''}${e.id ? ` id="${e.id}"` : ''}${e.name ? ` name="${e.name}"` : ''}> ${e.ariaLabel ? `[aria-label: ${e.ariaLabel}] ` : ''}${e.text}`
      )
      .join('\n');
  }
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Accessibility tree (the "Hermes view" of the page)
// ─────────────────────────────────────────────────────────────────────────────

export interface AccessibilitySnapshotOptions {
  /** Drop branches that contain no meaningful name/value. Default true. */
  interesting?: boolean;
  /** Max characters of the rendered text. Default 8000 (structural truncation). */
  maxChars?: number;
}

export interface AccessibilitySnapshot {
  text: string;
  element_count: number;
  truncated: boolean;
}

/**
 * Playwright 1.59 removed the `page.accessibility` API. We talk to CDP
 * directly (Accessibility.getFullAXTree) which is what the old Playwright
 * helper used internally. Reconstructs the tree via childIds → produces a
 * compact text rendering with refs `@e1, @e2…`.
 */
export async function getAccessibilityTree(page: Page, opts: AccessibilitySnapshotOptions = {}): Promise<AccessibilitySnapshot> {
  const interestingOnly = opts.interesting ?? true;
  const maxChars = opts.maxChars ?? 8000;

  const session = await page.context().newCDPSession(page);
  let result: any;
  try {
    result = await session.send('Accessibility.getFullAXTree');
  } finally {
    try { await session.detach(); } catch { /* ignore */ }
  }

  const nodes: any[] = (result && result.nodes) || [];
  if (nodes.length === 0) {
    return { text: '(empty accessibility tree)', element_count: 0, truncated: false };
  }

  const byId = new Map<string, any>();
  for (const n of nodes) byId.set(n.nodeId, n);

  const childIds = new Set<string>();
  for (const n of nodes) for (const c of (n.childIds || [])) childIds.add(c);
  const roots = nodes.filter(n => !childIds.has(n.nodeId));

  const getField = (f: any): string => {
    if (!f) return '';
    if (typeof f === 'string') return f;
    if (f.value !== undefined) return String(f.value);
    return '';
  };

  const isInteresting = (node: any): boolean => {
    if (!interestingOnly) return true;
    if (node.ignored) return false;
    const role = getField(node.role);
    const name = getField(node.name);
    if ((role === 'StaticText' || role === 'text') && !name) return false;
    if (role === 'InlineTextBox') return false;
    if (role === 'none' || role === 'presentation') return false;
    return true;
  };

  const lines: string[] = [];
  let counter = 0;

  const visit = (node: any, depth: number): void => {
    const keep = isInteresting(node);
    if (keep) {
      counter += 1;
      const ref = `@e${counter}`;
      const role = getField(node.role) || 'generic';
      const name = getField(node.name);
      const value = getField(node.value);
      const indent = '  '.repeat(depth);
      const nameStr = name ? ` ${JSON.stringify(name).slice(0, 200)}` : '';
      const valueStr = value ? ` value=${JSON.stringify(value).slice(0, 100)}` : '';
      lines.push(`${indent}${ref} ${role}${nameStr}${valueStr}`);
    }
    const childDepth = keep ? depth + 1 : depth;
    for (const cId of (node.childIds || [])) {
      const child = byId.get(cId);
      if (child) visit(child, childDepth);
    }
  };
  for (const root of roots) visit(root, 0);

  let text = lines.join('\n');
  let truncated = false;
  if (text.length > maxChars) {
    const out: string[] = [];
    let chars = 0;
    for (const line of lines) {
      if (chars + line.length + 1 > maxChars - 80) break;
      out.push(line);
      chars += line.length + 1;
    }
    const remaining = lines.length - out.length;
    out.push(`\n[... ${remaining} more lines truncated, raise maxChars for full snapshot]`);
    text = out.join('\n');
    truncated = true;
  }
  return { text, element_count: counter, truncated };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stealth (anti-detection) — extracted from web_search_with_warmup
// ─────────────────────────────────────────────────────────────────────────────

const STEALTH_INIT_SCRIPT = `
// Patch 1: navigator.webdriver
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

// Patch 2: chrome runtime mock
if (!window.chrome) { window.chrome = {}; }
if (!window.chrome.runtime) {
  window.chrome.runtime = {
    PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
    PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
    PlatformNaclArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
    RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
    OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
    OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' }
  };
}

// Patch 3: plugins
Object.defineProperty(navigator, 'plugins', {
  get: () => {
    const plugins = [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
    ];
    return Object.assign(plugins, { item: (i) => plugins[i], namedItem: (n) => plugins.find(p => p.name === n) });
  }
});

// Patch 4: languages
Object.defineProperty(navigator, 'languages', { get: () => ['es-ES', 'es', 'en-US', 'en'] });

// Patch 5: permissions API quirk
const originalQuery = window.navigator.permissions && window.navigator.permissions.query;
if (originalQuery) {
  window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })
      : originalQuery(parameters)
  );
}

// Patch 6: WebGL vendor/renderer
const getParameter = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(parameter) {
  if (parameter === 37445) return 'Intel Inc.';
  if (parameter === 37446) return 'Intel Iris OpenGL Engine';
  return getParameter.call(this, parameter);
};

// Patch 7: hairline feature
try {
  const elementDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  Object.defineProperty(HTMLDivElement.prototype, 'offsetHeight', {
    ...elementDescriptor,
    get: function() {
      if (this.id === 'modernizr') return 1;
      return elementDescriptor.get.apply(this);
    }
  });
} catch (e) {}
`;

const stealthApplied = new WeakSet<BrowserContext>();

export async function applyStealth(context: BrowserContext): Promise<void> {
  if (stealthApplied.has(context)) return;
  try {
    await context.addInitScript(STEALTH_INIT_SCRIPT);
  } catch {
    // Already injected (init scripts can't be removed; second add is silent on some Playwright versions).
  }
  stealthApplied.add(context);
}

// ─────────────────────────────────────────────────────────────────────────────
// Screenshot with rotation
// ─────────────────────────────────────────────────────────────────────────────

const SCREENSHOT_DIR = path.join(process.cwd(), 'screenshots');
const SCREENSHOT_RETENTION = 50;

export interface ScreenshotResult {
  path: string;
  bytes: number;
  base64: string;
}

export interface ScreenshotOptions {
  /** Full page (default) vs viewport only. */
  fullPage?: boolean;
  /** Override directory. Default ./screenshots/. */
  dir?: string;
  /** Override retention count. Default 50. */
  retention?: number;
}

export async function screenshot(page: Page, opts: ScreenshotOptions = {}): Promise<ScreenshotResult> {
  const dir = opts.dir ?? SCREENSHOT_DIR;
  const retention = opts.retention ?? SCREENSHOT_RETENTION;
  const fullPage = opts.fullPage ?? true;

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fname = `shot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
  const fpath = path.join(dir, fname);
  await page.screenshot({ path: fpath, fullPage });

  const buf = fs.readFileSync(fpath);
  const result: ScreenshotResult = { path: fpath, bytes: buf.byteLength, base64: buf.toString('base64') };

  // Rotate: keep the newest N PNGs in dir.
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.toLowerCase().endsWith('.png'))
      .map(f => ({ f, full: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (let i = retention; i < files.length; i++) {
      try { fs.unlinkSync(files[i].full); } catch { /* ignore */ }
    }
  } catch { /* ignore rotation errors */ }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Clean extract — markdown-style content + links + images
// ─────────────────────────────────────────────────────────────────────────────

export interface CleanExtractResult {
  title: string;
  url: string;
  content_md: string;
  links: { text: string; href: string }[];
  images: { alt: string; src: string }[];
  char_count: number;
}

export async function cleanExtract(page: Page): Promise<CleanExtractResult> {
  // NOTE: tsx/esbuild can inject a `__name` helper for *any* nested function
  // (arrow or declaration) when keepNames is on, and that helper isn't defined
  // inside the page sandbox. To avoid it we walk the DOM iteratively with a
  // manual stack and inline every helper — no nested functions in the body.
  return await page.evaluate(() => {
    const STRIP = [
      'nav', 'header', 'footer', 'aside', 'script', 'style', 'noscript',
      '[role=banner]', '[role=navigation]', '[role=complementary]', '[role=contentinfo]',
      '.ad', '.ads', '.advertisement', '.banner-ad', '.cookie', '.cookie-banner',
      '.newsletter', '.subscribe', '.popup', '.modal-backdrop',
    ];

    const clone = document.body.cloneNode(true) as HTMLElement;
    for (const sel of STRIP) {
      try { clone.querySelectorAll(sel).forEach(el => el.remove()); } catch { /* ignore */ }
    }

    const main: HTMLElement =
      (clone.querySelector('main') as HTMLElement) ||
      (clone.querySelector('article') as HTMLElement) ||
      (clone.querySelector('[role=main]') as HTMLElement) ||
      clone;

    const blocks: string[] = [];

    // Iterative DOM walk. Stack stores elements still to process; we process
    // one tag at a time, optionally emitting a block, and only descend into
    // children for "container" elements we don't recognise as a leaf block.
    const stack: Element[] = [main];
    while (stack.length > 0) {
      const el = stack.shift() as Element;
      const tag = el.tagName.toLowerCase();
      let consumed = false;

      if (/^h[1-6]$/.test(tag)) {
        const level = parseInt(tag[1], 10);
        const t = (((el as any).innerText || el.textContent || '') as string).replace(/\s+/g, ' ').trim();
        if (t) blocks.push('#'.repeat(level) + ' ' + t);
        consumed = true;
      } else if (tag === 'p') {
        const t = (((el as any).innerText || el.textContent || '') as string).replace(/\s+/g, ' ').trim();
        if (t) blocks.push(t);
        consumed = true;
      } else if (tag === 'ul' || tag === 'ol') {
        const items: string[] = [];
        const lis = el.querySelectorAll(':scope > li');
        for (let i = 0; i < lis.length; i++) {
          const t = (((lis[i] as any).innerText || lis[i].textContent || '') as string).replace(/\s+/g, ' ').trim();
          if (t) items.push('- ' + t);
        }
        if (items.length) blocks.push(items.join('\n'));
        consumed = true;
      } else if (tag === 'pre' || tag === 'code') {
        const raw = (((el as any).innerText || el.textContent || '') as string).trim();
        if (raw) blocks.push('```\n' + raw + '\n```');
        consumed = true;
      } else if (tag === 'blockquote') {
        const t = (((el as any).innerText || el.textContent || '') as string).replace(/\s+/g, ' ').trim();
        if (t) blocks.push('> ' + t);
        consumed = true;
      }

      if (!consumed) {
        const kids = el.children;
        // Insert children at the front in reverse order to preserve doc order.
        for (let i = kids.length - 1; i >= 0; i--) stack.unshift(kids[i]);
      }
    }

    // Fallback: pages built on tables (Hacker News, old forums, simple wikis)
    // produce zero structural blocks. Degrade gracefully to the cleaned
    // innerText of the main container so the agent still gets usable content.
    if (blocks.length === 0) {
      const fallback = (((main as any).innerText || main.textContent || '') as string)
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (fallback) blocks.push(fallback);
    }

    let content_md = blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
    if (content_md.length > 30000) content_md = content_md.slice(0, 30000) + '\n\n[... truncated]';

    const links: any[] = [];
    const anchors = main.querySelectorAll('a[href]');
    for (let i = 0; i < anchors.length && links.length < 100; i++) {
      const a = anchors[i] as any;
      const t = (((a.innerText || a.textContent || '') as string)).trim();
      if (t.length > 0) links.push({ text: t.slice(0, 200), href: a.href });
    }

    const images: any[] = [];
    const imgs = main.querySelectorAll('img[src]');
    for (let i = 0; i < imgs.length && images.length < 50; i++) {
      const img = imgs[i] as any;
      images.push({ alt: img.alt || '', src: img.src });
    }

    return {
      title: document.title,
      url: window.location.href,
      content_md,
      links,
      images,
      char_count: content_md.length,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Vision fallback (opt-in via SHINOBI_BROWSER_VISION=1)
// ─────────────────────────────────────────────────────────────────────────────

export interface VisionResult {
  success: boolean;
  analysis?: string;
  screenshot_path?: string;
  model?: string;
  error?: string;
}

const DEFAULT_VISION_MODEL = 'anthropic/claude-haiku-4.5';

export async function visionAnalyze(page: Page, question: string): Promise<VisionResult> {
  if (process.env.SHINOBI_BROWSER_VISION !== '1') {
    return { success: false, error: 'SHINOBI_BROWSER_VISION not enabled (set env SHINOBI_BROWSER_VISION=1)' };
  }
  if (!process.env.OPENROUTER_API_KEY) {
    return { success: false, error: 'OPENROUTER_API_KEY not set in .env — required for vision fallback' };
  }

  const shot = await screenshot(page, { fullPage: false });
  const dataUrl = `data:image/png;base64,${shot.base64}`;
  const model = process.env.OPENROUTER_VISION_MODEL || DEFAULT_VISION_MODEL;

  const result = await invokeLLMViaOpenRouter({
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: question },
      ],
    }],
    temperature: 0.2,
    max_tokens: 1024,
  });

  if (!result.success) {
    return { success: false, error: result.error, screenshot_path: shot.path, model };
  }
  // Parseo defensivo: si el provider devuelve texto plano en vez del JSON
  // del message, NO se reporta "parse failed" — el texto ES el análisis.
  let content = '';
  try {
    const msg = JSON.parse(result.output);
    content = typeof msg.content === 'string'
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map((p: any) => p.text || '').join('')
        : '';
  } catch {
    content = typeof result.output === 'string' ? result.output : String(result.output ?? '');
  }
  return { success: true, analysis: content, screenshot_path: shot.path, model };
}

// ─────────────────────────────────────────────────────────────────────────────
// Misc helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Random delay in ms, useful for human-like timings between actions. */
export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(minMs + Math.random() * (maxMs - minMs));
  return new Promise(res => setTimeout(res, ms));
}
