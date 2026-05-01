import { type Tool, type ToolResult, registerTool } from './tool_registry.js';

const browserClickTool: Tool = {
  name: 'browser_click',
  description: 'Click a button or link in the active browser tab connected via CDP on port 9222. Searches by visible text content (case-insensitive). Returns the new page state after the click. Use this when the user asks to click "Next", "Submit", "Load more", or any visible button. Requires an existing browser tab (use web_search first to navigate).',
  parameters: {
    type: 'object',
    properties: {
      button_text: { type: 'string', description: 'Visible text of the button or link to click. Case-insensitive partial match.' },
      url_contains: { type: 'string', description: 'Optional: substring to identify which tab to click in.' },
      wait_after_ms: { type: 'number', description: 'Optional: milliseconds to wait after click. Default 3000.' }
    },
    required: ['button_text']
  },

  async execute(args: { button_text: string; url_contains?: string; wait_after_ms?: number }): Promise<ToolResult> {
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

      const targetText = args.button_text;
      const waitMs = args.wait_after_ms ?? 3000;

      const clickResult = await page.evaluate((text) => {
        const lowerText = text.toLowerCase();
        const candidates = document.querySelectorAll('button, a, [role="button"], [role="link"]');
        const matches = [];
        for (let i = 0; i < candidates.length; i++) {
          const el = candidates[i];
          const elText = ((el.innerText || el.textContent || '') + '').trim();
          const ariaLabel = el.getAttribute('aria-label') || '';
          if (elText.toLowerCase().includes(lowerText) || ariaLabel.toLowerCase().includes(lowerText)) {
            const rect = el.getBoundingClientRect();
            const visible = rect.width > 0 && rect.height > 0;
            matches.push({ index: i, text: elText.slice(0, 80), aria: ariaLabel, visible, tag: el.tagName.toLowerCase() });
          }
        }
        return { totalCandidates: candidates.length, matches };
      }, targetText);

      if (clickResult.matches.length === 0) {
        return { success: false, output: '', error: `No clickable with text "${targetText}". Scanned ${clickResult.totalCandidates} elements.` };
      }

      const visibleMatch = clickResult.matches.find(m => m.visible) || clickResult.matches[0];

      let clickError = '';
      try {
        await page.click(`text=${targetText}`, { timeout: 5000 });
      } catch (e) {
        try {
          await page.getByRole('button', { name: new RegExp(targetText, 'i') }).first().click({ timeout: 5000 });
        } catch (e2) {
          try {
            await page.getByRole('link', { name: new RegExp(targetText, 'i') }).first().click({ timeout: 5000 });
          } catch (e3: any) {
            clickError = e3.message;
          }
        }
      }

      if (clickError) {
        return { success: false, output: '', error: `All click strategies failed. Last: ${clickError}. Candidates: ${JSON.stringify(clickResult.matches.slice(0, 5))}` };
      }

      await page.waitForTimeout(waitMs);

      const afterState = await page.evaluate(() => {
        const body = document.body;
        let bodyText = '';
        if (body) {
          bodyText = (body.innerText || '').replace(/\s+/g, ' ').trim();
          if (bodyText.length > 6000) bodyText = bodyText.slice(0, 6000) + '...[truncated]';
        }
        const linkNodes = document.querySelectorAll('a[href]');
        const links = [];
        for (let i = 0; i < linkNodes.length && links.length < 100; i++) {
          const a = linkNodes[i];
          const t = ((a.innerText || a.textContent || '') + '').trim();
          if (t.length > 0) links.push({ text: t.length > 200 ? t.slice(0, 200) : t, href: a.href });
        }
        return { bodyText, links, currentUrl: window.location.href, title: document.title };
      });

      let stdout = `Clicked "${targetText}" on tab: ${page.url()}\n`;
      stdout += `Matched: <${visibleMatch.tag}> "${visibleMatch.text}"\n\n`;
      stdout += `--- AFTER CLICK ---\nTitle: ${afterState.title}\nURL: ${afterState.currentUrl}\n\n`;
      stdout += `--- BODY TEXT (${afterState.bodyText.length} chars) ---\n${afterState.bodyText}\n\n`;
      stdout += `--- LINKS (${afterState.links.length}) ---\n`;
      stdout += afterState.links.map((l, i) => `${i+1}. [${l.text}] -> ${l.href}`).join('\n');

      return { success: true, output: stdout };
    } catch (err: any) {
      if (err.message?.includes('ECONNREFUSED')) {
        return { success: false, output: '', error: 'No browser on port 9222.' };
      }
      return { success: false, output: '', error: `browser_click error: ${err.message}` };
    }
  }
};

registerTool(browserClickTool);
export default browserClickTool;
