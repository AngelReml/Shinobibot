/**
 * WebSearch Tool — Search the web or navigate to URLs via Playwright CDP
 * Preserved from original Shinobi Playwright integration
 */
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';

const webSearchTool: Tool = {
  name: 'web_search',
  description: 'Search the web using Bing or navigate to a specific website. Requires a Chromium browser running with --remote-debugging-port=9222. Returns page titles and search result snippets.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query or URL to navigate to (e.g. "best node.js frameworks" or "youtube.com")' },
    },
    required: ['query'],
  },

  async execute(args: { query: string }): Promise<ToolResult> {
    try {
      const { chromium } = await import('playwright');

      const browser = await chromium.connectOverCDP('http://localhost:9222');
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
          await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          isNewPage = false;
        } else {
          page = await ctx.newPage();
          isNewPage = true;
          await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        }

        await page.waitForTimeout(3000);
        const title = await page.title();
        const finalUrl = page.url();
        stdout = `Navigated to: ${fullUrl}\nFinal URL: ${finalUrl}\nPage title: ${title}`;

        // Si hubo redirect (URL final diferente a inicial), reportarlo explícitamente
        if (finalUrl !== fullUrl) {
          stdout += `\n[WARNING] Redirected from ${fullUrl} to ${finalUrl}`;
        }

        if (isNewPage && page) await page.close();
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
          await page.goto(`https://${targetDomain}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(3000);
          const title = await page.title();
          stdout = `Navigated to: https://${targetDomain}\nPage title: ${title}`;
        }
      } else {
        // Bing search
        const ctx = allContexts[0] || await browser.newContext();
        page = await ctx.newPage();
        isNewPage = true;
        const cleanQuery = args.query.replace(/busca\s+(en\s+google\s+)?|search\s+(for\s+)?/gi, '').trim();
        await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(cleanQuery)}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('h2 a', { timeout: 10000 }).catch(() => {});

        const results: { title: string; link: string }[] = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('h2 a')).slice(0, 5).map(a => ({
            title: (a as HTMLElement).innerText.trim(),
            link: (a as HTMLAnchorElement).href,
          }));
        });

        stdout = `Search results for "${cleanQuery}":\n\n` +
          results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.link}`).join('\n\n');
      }

      if (isNewPage && page) await page.close();

      return { success: true, output: stdout };
    } catch (err: any) {
      if (err.message?.includes('ECONNREFUSED')) {
        return { success: false, output: '', error: 'No browser detected on port 9222. Start Chrome with: chrome --remote-debugging-port=9222' };
      }
      return { success: false, output: '', error: `Web search error: ${err.message}` };
    }
  },
};

registerTool(webSearchTool);
export default webSearchTool;
