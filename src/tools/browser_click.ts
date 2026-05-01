import { type Tool, type ToolResult, registerTool } from './tool_registry.js';

const browserClickTool: Tool = {
  name: 'browser_click',
  description: 'Click an element in the active browser tab connected via CDP on port 9222. Supports three matching strategies: by visible text content (button_text), by CSS selector (css_selector), or by aria-label (aria_label). Returns the new page state after the click. At least one of button_text, css_selector, or aria_label must be provided.',
  parameters: {
    type: 'object',
    properties: {
      button_text: {
        type: 'string',
        description: 'Visible text of the button or link to click. Case-insensitive partial match.'
      },
      css_selector: {
        type: 'string',
        description: 'CSS selector to identify the element (e.g. "button.share", "a[data-testid=submit]"). Used when text is not reliable (icons, SVG buttons).'
      },
      aria_label: {
        type: 'string',
        description: 'aria-label attribute of the element (e.g. "More actions", "Share"). Useful for SVG buttons or icon-only elements.'
      },
      url_contains: {
        type: 'string',
        description: 'Optional: substring to identify which tab to click in.'
      },
      wait_after_ms: {
        type: 'number',
        description: 'Optional: milliseconds to wait after click. Default 3000.'
      }
    }
  },

  async execute(args: { button_text?: string; css_selector?: string; aria_label?: string; url_contains?: string; wait_after_ms?: number }): Promise<ToolResult> {
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

      if (!args.button_text && !args.css_selector && !args.aria_label) {
        return { success: false, output: '', error: 'At least one of button_text, css_selector, or aria_label is required.' };
      }

      const waitMs = args.wait_after_ms ?? 3000;
      let strategy_used = '';
      let strategy_error = '';
      let matched_descriptor = '';

      // ESTRATEGIA 1: CSS selector (más preciso, intentar primero si se proporciona)
      if (args.css_selector && !strategy_used) {
        try {
          const locator = page.locator(args.css_selector).first();
          const count = await locator.count();
          if (count > 0) {
            await locator.click({ timeout: 5000 });
            strategy_used = 'css_selector';
            matched_descriptor = args.css_selector;
          } else {
            strategy_error = `css_selector "${args.css_selector}" matched 0 elements`;
          }
        } catch (e: any) {
          strategy_error = `css_selector failed: ${e.message}`;
        }
      }

      // ESTRATEGIA 2: aria-label exacto (útil para SVG/icon buttons)
      if (args.aria_label && !strategy_used) {
        try {
          const locator = page.locator(`[aria-label="${args.aria_label}"]`).first();
          const count = await locator.count();
          if (count > 0) {
            await locator.click({ timeout: 5000 });
            strategy_used = 'aria_label_exact';
            matched_descriptor = args.aria_label;
          } else {
            // Fallback: aria-label parcial (case-insensitive)
            const partial = page.locator(`[aria-label*="${args.aria_label}" i]`).first();
            const partialCount = await partial.count();
            if (partialCount > 0) {
              await partial.click({ timeout: 5000 });
              strategy_used = 'aria_label_partial';
              matched_descriptor = args.aria_label;
            } else {
              strategy_error = (strategy_error ? strategy_error + ' | ' : '') + `aria-label "${args.aria_label}" not found`;
            }
          }
        } catch (e: any) {
          strategy_error = (strategy_error ? strategy_error + ' | ' : '') + `aria_label failed: ${e.message}`;
        }
      }

      // ESTRATEGIA 3: texto visible (la original, ahora como fallback)
      if (args.button_text && !strategy_used) {
        const targetText = args.button_text;
        try {
          await page.click(`text=${targetText}`, { timeout: 5000 });
          strategy_used = 'text_exact';
          matched_descriptor = targetText;
        } catch (e1) {
          try {
            await page.getByRole('button', { name: new RegExp(targetText, 'i') }).first().click({ timeout: 5000 });
            strategy_used = 'role_button';
            matched_descriptor = targetText;
          } catch (e2) {
            try {
              await page.getByRole('link', { name: new RegExp(targetText, 'i') }).first().click({ timeout: 5000 });
              strategy_used = 'role_link';
              matched_descriptor = targetText;
            } catch (e3: any) {
              strategy_error = (strategy_error ? strategy_error + ' | ' : '') + `button_text all strategies failed: ${e3.message}`;
            }
          }
        }
      }

      if (!strategy_used) {
        return {
          success: false,
          output: '',
          error: `All click strategies failed. ${strategy_error}`
        };
      }

      await page.waitForTimeout(waitMs);

      const afterState = await page.evaluate(() => {
        const body = document.body;
        let bodyText = '';
        if (body) {
          bodyText = (body.innerText || '').replace(/\s+/g, ' ').trim();
          if (bodyText.length > 8000) bodyText = bodyText.slice(0, 8000) + '...[truncated]';
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

      let stdout = `Clicked using strategy: ${strategy_used}\nMatched: ${matched_descriptor}\nTab: ${page.url()}\n\n`;
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
