import { type Tool, type ToolResult, registerTool } from './tool_registry.js';

const browserScrollTool: Tool = {
  name: 'browser_scroll',
  description: 'Scroll the active browser tab to load lazy-loaded content (comments, infinite scroll feeds, lazy images). Performs N scroll cycles with a wait between each, then re-extracts the page state. Use this BEFORE browser_click or web_search if the target content requires scrolling to appear.',
  parameters: {
    type: 'object',
    properties: {
      scroll_count: {
        type: 'number',
        description: 'How many scroll cycles to perform. Default 3.'
      },
      scroll_pixels: {
        type: 'number',
        description: 'Pixels to scroll per cycle. Default 1000 (about one viewport).'
      },
      wait_between_ms: {
        type: 'number',
        description: 'Milliseconds to wait between scrolls for content to load. Default 1500.'
      },
      url_contains: {
        type: 'string',
        description: 'Optional: substring to identify which tab to scroll in.'
      }
    }
  },

  async execute(args: { scroll_count?: number; scroll_pixels?: number; wait_between_ms?: number; url_contains?: string }): Promise<ToolResult> {
    try {
      const { chromium } = await import('playwright');
      const browser = await chromium.connectOverCDP('http://localhost:9222');
      const contexts = browser.contexts();
      const allPages = contexts.flatMap(c => c.pages());

      if (allPages.length === 0) {
        return { success: false, output: '', error: 'No browser tabs found.' };
      }

      let page;
      if (args.url_contains) {
        page = allPages.find(p => p.url().toLowerCase().includes(args.url_contains!.toLowerCase()));
        if (!page) {
          return { success: false, output: '', error: `No tab with URL containing "${args.url_contains}". Open: ${allPages.map(p => p.url()).join(', ')}` };
        }
      } else {
        page = allPages[allPages.length - 1];
      }

      const cycles = args.scroll_count ?? 3;
      const pixels = args.scroll_pixels ?? 1000;
      const waitMs = args.wait_between_ms ?? 1500;

      const scrollLog: any[] = [];

      for (let i = 0; i < cycles; i++) {
        const beforeHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        const beforeScroll = await page.evaluate(() => window.scrollY);
        
        await page.evaluate((px: number) => window.scrollBy(0, px), pixels);
        await page.waitForTimeout(waitMs);
        
        const afterHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        const afterScroll = await page.evaluate(() => window.scrollY);
        
        scrollLog.push({
          cycle: i + 1,
          before_scroll_y: beforeScroll,
          after_scroll_y: afterScroll,
          height_growth_px: afterHeight - beforeHeight
        });
      }

      const finalState = await page.evaluate(() => {
        const body = document.body;
        let bodyText = '';
        if (body) {
          bodyText = (body.innerText || '').replace(/\s+/g, ' ').trim();
          if (bodyText.length > 12000) bodyText = bodyText.slice(0, 12000) + '...[truncated]';
        }
        const linkNodes = document.querySelectorAll('a[href]');
        const links = [];
        for (let i = 0; i < linkNodes.length && links.length < 150; i++) {
          const a = linkNodes[i];
          const t = ((a.innerText || a.textContent || '') + '').trim();
          if (t.length > 0) links.push({ text: t.length > 200 ? t.slice(0, 200) : t, href: a.href });
        }
        return { bodyText, links, currentUrl: window.location.href, title: document.title, finalScrollY: window.scrollY, finalHeight: document.documentElement.scrollHeight };
      });

      let stdout = `Scrolled ${cycles} cycles (${pixels}px each, ${waitMs}ms wait) on tab: ${page.url()}\n`;
      stdout += `Final scroll: ${finalState.finalScrollY} / ${finalState.finalHeight}\n\n`;
      stdout += `--- SCROLL LOG ---\n`;
      stdout += scrollLog.map(s => `Cycle ${s.cycle}: scrollY ${s.before_scroll_y}->${s.after_scroll_y} | height grew ${s.height_growth_px}px`).join('\n');
      stdout += `\n\n--- FINAL STATE ---\nTitle: ${finalState.title}\nURL: ${finalState.currentUrl}\n\n`;
      stdout += `--- BODY TEXT (${finalState.bodyText.length} chars) ---\n${finalState.bodyText}\n\n`;
      stdout += `--- LINKS (${finalState.links.length}) ---\n`;
      stdout += finalState.links.map((l, i) => `${i+1}. [${l.text}] -> ${l.href}`).join('\n');

      return { success: true, output: stdout };
    } catch (err: any) {
      if (err.message?.includes('ECONNREFUSED')) {
        return { success: false, output: '', error: 'No browser on port 9222.' };
      }
      return { success: false, output: '', error: `browser_scroll error: ${err.message}` };
    }
  }
};

registerTool(browserScrollTool);
export default browserScrollTool;
