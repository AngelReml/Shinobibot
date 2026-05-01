import { type Tool, type ToolResult, registerTool } from './tool_registry.js';

const browserClickPositionTool: Tool = {
  name: 'browser_click_position',
  description: 'Click the Nth element matching a CSS selector (1-indexed). Use this for SPAs (Single Page Applications) where elements do not have unique URLs or text — for example, clicking the 1st notebook in a list of notebook cards. Returns the new page state and the URL after navigation.',
  parameters: {
    type: 'object',
    properties: {
      css_selector: {
        type: 'string',
        description: 'CSS selector that matches multiple candidate elements (e.g. ".notebook-card", "[role=listitem]").'
      },
      index: {
        type: 'number',
        description: '1-indexed position of the element to click. Default 1 (first match).'
      },
      url_contains: {
        type: 'string',
        description: 'Optional: substring to identify which tab to click in.'
      },
      wait_after_ms: {
        type: 'number',
        description: 'Optional: milliseconds to wait after click. Default 3000.'
      }
    },
    required: ['css_selector']
  },

  async execute(args: { css_selector: string; index?: number; url_contains?: string; wait_after_ms?: number }): Promise<ToolResult> {
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

      const targetIndex = (args.index ?? 1) - 1; // 1-indexed → 0-indexed
      const waitMs = args.wait_after_ms ?? 3000;

      const inventory = await page.evaluate((selector: string) => {
        const elements = document.querySelectorAll(selector);
        const items = [];
        for (let i = 0; i < elements.length && i < 20; i++) {
          const el = elements[i];
          const text = ((el as HTMLElement).innerText || el.textContent || '').trim().slice(0, 150);
          const aria = el.getAttribute('aria-label') || '';
          items.push({ position: i + 1, text, aria_label: aria });
        }
        return { total_matches: elements.length, items };
      }, args.css_selector);

      if (inventory.total_matches === 0) {
        return { success: false, output: '', error: `Selector "${args.css_selector}" matched 0 elements on the page.` };
      }

      if (targetIndex >= inventory.total_matches) {
        return { success: false, output: '', error: `Requested index ${targetIndex + 1} but only ${inventory.total_matches} elements match "${args.css_selector}".` };
      }

      const urlBefore = page.url();

      try {
        await page.locator(args.css_selector).nth(targetIndex).click({ timeout: 5000 });
      } catch (e: any) {
        return { success: false, output: '', error: `Click on element ${targetIndex + 1} of "${args.css_selector}" failed: ${e.message}` };
      }

      await page.waitForTimeout(waitMs);

      const afterState = await page.evaluate(() => {
        const body = document.body;
        let bodyText = '';
        if (body) {
          bodyText = (body.innerText || '').replace(/\s+/g, ' ').trim();
          if (bodyText.length > 8000) bodyText = bodyText.slice(0, 8000) + '...[truncated]';
        }
        return { bodyText, currentUrl: window.location.href, title: document.title };
      });

      const navigated = afterState.currentUrl !== urlBefore;

      let stdout = `Clicked element #${targetIndex + 1} of selector "${args.css_selector}"\n`;
      stdout += `Total matches found: ${inventory.total_matches}\n`;
      stdout += `URL before: ${urlBefore}\nURL after: ${afterState.currentUrl}\n`;
      stdout += `Navigated: ${navigated}\n\n`;
      stdout += `--- INVENTORY (first 20 candidates) ---\n`;
      stdout += inventory.items.map(it => `#${it.position}: "${it.text}" ${it.aria_label ? `[aria: ${it.aria_label}]` : ''}`).join('\n');
      stdout += `\n\n--- AFTER CLICK ---\nTitle: ${afterState.title}\nURL: ${afterState.currentUrl}\n\n`;
      stdout += `--- BODY TEXT (${afterState.bodyText.length} chars) ---\n${afterState.bodyText}`;

      return { success: true, output: stdout };
    } catch (err: any) {
      if (err.message?.includes('ECONNREFUSED')) {
        return { success: false, output: '', error: 'No browser on port 9222.' };
      }
      return { success: false, output: '', error: `browser_click_position error: ${err.message}` };
    }
  }
};

registerTool(browserClickPositionTool);
export default browserClickPositionTool;
