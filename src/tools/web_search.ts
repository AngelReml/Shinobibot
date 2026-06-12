/**
 * WebSearch Tool — Search the web or navigate to URLs via Playwright CDP
 * Preserved from original Shinobi Playwright integration
 */
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { connectOrLaunchCDP } from './browser_cdp.js';
import { extractDom, formatPageState } from './browser_engine.js';

const webSearchTool: Tool = {
  name: 'web_search',
  description: 'INTERNAL web fetch. For ANY user research or investigation request you MUST NOT call this tool — call `research_agent_run` instead, the dedicated specialist. Use web_search directly ONLY to navigate to a known exact URL. Requires a Chromium browser. Returns page titles and search result snippets.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query or URL to navigate to (e.g. "best node.js frameworks" or "youtube.com")' },
    },
    required: ['query'],
  },

  async execute(args: { query: string }): Promise<ToolResult> {
    // Navegación configurable. Default producción: networkidle/45s (espera a SPAs).
    // En benchmark (SHINOBI_NAV_WAIT=domcontentloaded, timeout corto) cada página
    // carga rápido — networkidle casi nunca se alcanza (ads) y consume 45s/página,
    // disparando el timeout de tarea. Mantiene un fallback a domcontentloaded.
    const NAV_WAIT = (process.env.SHINOBI_NAV_WAIT as 'networkidle' | 'domcontentloaded' | 'load') || 'networkidle';
    const NAV_TIMEOUT = Number(process.env.SHINOBI_NAV_TIMEOUT_MS) || 45000;
    const NAV_SETTLE = Number(process.env.SHINOBI_NAV_SETTLE_MS) || 2000;
    try {
      const browser = await connectOrLaunchCDP();
      const allContexts = browser.contexts();
      const allPages = allContexts.flatMap(ctx => ctx.pages());

      let page: any = null;
      let isNewPage = false;
      let stdout = '';

      // Detectar URL completa (http:// o https://) — navegar tal cual sin extraer dominio
      const isFullUrl = /^https?:\/\//i.test(args.query.trim());

      if (isFullUrl) {
        const fullUrl = args.query.trim();
        const ctx = allContexts[0] || await browser.newContext();

        // Reutilizar pestaña si alguna ya está en el mismo origen
        const urlObj = new URL(fullUrl);
        page = allPages.find(p => {
          try { return new URL(p.url()).origin === urlObj.origin; }
          catch { return false; }
        });

        if (page) {
          // SPA-aware: networkidle espera a que los frameworks terminen de pintar
          await page.goto(fullUrl, { waitUntil: NAV_WAIT, timeout: NAV_TIMEOUT }).catch(() =>
            page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
          );
          isNewPage = false;
        } else {
          page = await ctx.newPage();
          isNewPage = true;
          await page.goto(fullUrl, { waitUntil: NAV_WAIT, timeout: NAV_TIMEOUT }).catch(() =>
            page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
          );
        }

        // YouTube/SPA: esperar al contenedor de contenido real antes de scraping
        if (/youtube\.com/i.test(fullUrl)) {
          await page.waitForSelector('ytd-rich-grid-media, #contents, ytd-video-renderer', { timeout: 15000 }).catch(() => {});
        } else if (/notebooklm\.google|docs\.google/i.test(fullUrl)) {
          await page.waitForSelector('[data-id], .docs-title-widget, .notebook-content', { timeout: 15000 }).catch(() => {});
        } else {
          // Fallback genérico: espera corta para SPAs arbitrarias
          await page.waitForTimeout(NAV_SETTLE);
        }
        const title = await page.title();
        const finalUrl = page.url();

        // Bloque 2: extracción consolidada en browser_engine. Mismo formato de salida.
        const state = await extractDom(page, { maxBodyChars: 12000, maxLinks: 150, maxInteractive: 80 });

        stdout = `Navigated to: ${fullUrl}\nFinal URL: ${finalUrl}\nPage title: ${title}\n`;
        if (finalUrl !== fullUrl) {
          stdout += `[WARNING] Redirected from ${fullUrl} to ${finalUrl}\n`;
        }
        stdout += '\n' + formatPageState(state, { showInteractive: true });

        // NO cerramos la pestaña aunque sea nueva: futuros pasos del flujo (browser_click, browser_scroll, browser_click_position) la necesitan viva.
        return { success: true, output: stdout };
      }

      // --- Lógica existente de domainMatch / Bing search (intacta) ---
      // Check if query looks like a domain
      const domainMatch = args.query.match(/\b([\w-]+\.(com|es|org|io|net|dev))\b/i);
      const isYouTube = /youtube/i.test(args.query);
      const targetDomain = isYouTube ? 'youtube.com' : (domainMatch ? domainMatch[1] : null);

      if (targetDomain) {
        // Try to reuse existing tab
        page = allPages.find(p => p.url().includes(targetDomain));
        if (page) {
          await page.waitForTimeout(1000);
          const title = await page.title();
          stdout = `Reused existing tab: ${page.url()}\nPage title: ${title}`;

          if (isYouTube) {
            const videoTitle = await page.evaluate(() => {
              const sels = [
                'ytd-rich-item-renderer #video-title',
                'ytd-compact-video-renderer #video-title',
                '#video-title',
              ];
              for (const sel of sels) {
                for (const el of document.querySelectorAll(sel)) {
                  const t = el.textContent?.trim();
                  if (t && t.length > 3 && t !== 'Saltar navegación') return t;
                }
              }
              return null;
            });
            if (videoTitle) stdout += `\nFirst video: ${videoTitle}`;
          }
        } else {
          const ctx = allContexts[0] || await browser.newContext();
          page = await ctx.newPage();
          isNewPage = true;
          await page.goto(`https://${targetDomain}`, { waitUntil: NAV_WAIT, timeout: NAV_TIMEOUT }).catch(() =>
            page.goto(`https://${targetDomain}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
          );
          if (/youtube\.com/i.test(targetDomain)) {
            await page.waitForSelector('ytd-rich-grid-media, #contents, ytd-video-renderer', { timeout: 15000 }).catch(() => {});
          } else {
            await page.waitForTimeout(NAV_SETTLE);
          }
          const title = await page.title();
          stdout = `Navigated to: https://${targetDomain}\nPage title: ${title}`;
        }
      } else {
        const ctx = allContexts[0] || await browser.newContext();
        page = await ctx.newPage();
        isNewPage = true;
        const cleanQuery = args.query.replace(/busca\s+(en\s+google\s+)?|search\s+(for\s+)?/gi, '').trim();

        // Motor de búsqueda configurable. Bing (default) scrapea bien en un
        // navegador real, pero en HEADLESS sirve una página anti-bot degradada
        // (sin resultados). DuckDuckGo HTML (html.duckduckgo.com, sin JS) sí
        // funciona headless. SHINOBI_SEARCH_ENGINE=ddg lo activa (lo usa la cata).
        const engine = (process.env.SHINOBI_SEARCH_ENGINE || 'bing').toLowerCase();

        if (engine === 'ddg' || engine === 'duckduckgo') {
          await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await page.waitForSelector('a.result__a', { timeout: 10000 }).catch(() => {});
          const results: { title: string; link: string }[] = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('div.result')).slice(0, 6).map((d) => {
              const a = d.querySelector('a.result__a') as HTMLAnchorElement | null;
              const sn = d.querySelector('.result__snippet') as HTMLElement | null;
              return { title: a ? a.innerText.trim() : '', link: a ? a.href : '', snippet: sn ? sn.innerText.trim() : '' };
            }).filter((r) => r.title);
          }) as any;
          stdout = `Search results for "${cleanQuery}" (DuckDuckGo):\n\n` +
            results.map((r: any, i: number) => `${i + 1}. ${r.title}\n   ${r.link}${r.snippet ? `\n   ${r.snippet}` : ''}`).join('\n\n');
        } else {
          // Bing (navegador real)
          await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(cleanQuery)}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() =>
            page.goto(`https://www.bing.com/search?q=${encodeURIComponent(cleanQuery)}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
          );
          await page.waitForSelector('h2 a', { timeout: 10000 }).catch(() => {});
          // FIX (batería 2026-06-10): antes solo devolvíamos título+link, sin
          // descripción. El agente no podía juzgar la relevancia y declaraba
          // "no relevante" sin abrir nada (medido con tau-bench). Extraemos
          // también el snippet por resultado (.b_caption p / .b_algoSlug) para
          // que pueda decidir qué abrir.
          const results: { title: string; link: string; snippet: string }[] = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('li.b_algo')).slice(0, 5);
            const out = items.map((li) => {
              const a = li.querySelector('h2 a') as HTMLAnchorElement | null;
              const cap = li.querySelector('.b_caption p, .b_algoSlug, p') as HTMLElement | null;
              return {
                title: a ? a.innerText.trim() : '',
                link: a ? a.href : '',
                snippet: cap ? cap.innerText.trim().slice(0, 300) : '',
              };
            }).filter((r) => r.title && r.link);
            // Fallback al selector antiguo si la maquetación de Bing cambió.
            if (out.length === 0) {
              return Array.from(document.querySelectorAll('h2 a')).slice(0, 5).map((a) => ({
                title: (a as HTMLElement).innerText.trim(),
                link: (a as HTMLAnchorElement).href,
                snippet: '',
              }));
            }
            return out;
          }) as any;
          stdout = `Search results for "${cleanQuery}":\n\n` +
            results.map((r: any, i: number) => `${i + 1}. ${r.title}\n   ${r.link}${r.snippet ? `\n   ${r.snippet}` : ''}`).join('\n\n');
        }
        // Hint: el agente puede LEER cualquier resultado llamando web_search con
        // su URL (el path isFullUrl extrae la página entera). Sin esto, tendía a
        // re-buscar en bucle en vez de abrir el primer resultado prometedor.
        if (stdout) {
          stdout += `\n\n[sugerencia] Para leer el contenido de un resultado, llama web_search de nuevo con su URL exacta.`;
        }
        if (isNewPage && page) await page.close();
      }

      return { success: true, output: stdout };
    } catch (err: any) {
      return { success: false, output: '', error: `Web search error: ${err.message}` };
    }
  },
};

registerTool(webSearchTool);
export default webSearchTool;
