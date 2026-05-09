import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { connectOrLaunchCDP } from './browser_cdp.js';
import { applyStealth } from './browser_engine.js';

const BLOCK_SIGNALS = [
  /it needs a human touch/i,
  /pxcr\d+/i,
  /just a moment/i,
  /attention required/i,
  /cf-please-wait/i,
  /verifying you are human/i,
  /access denied/i,
  /captcha/i,
  /cloudflare/i,
  /un momento/i
];

function detectBlock(stdout: string): { blocked: boolean; signal: string } {
  for (const sig of BLOCK_SIGNALS) {
    const m = stdout.match(sig);
    if (m) return { blocked: true, signal: m[0] };
  }
  return { blocked: false, signal: '' };
}

function getDomainWarmupUrl(targetUrl: string): string | null {
  try {
    const u = new URL(targetUrl);
    return `${u.protocol}//${u.host}/robots.txt`;
  } catch {
    return null;
  }
}

const webSearchWithWarmupTool: Tool = {
  name: 'web_search_with_warmup',
  description: 'Anti-bot mitigation: warm-up request + stealth init script (navigator.webdriver, chrome.runtime, plugins, WebGL spoofing) + retry with exponential backoff. Use for Fiverr, Upwork, LinkedIn.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Full URL to navigate to.' },
      max_retries: { type: 'number', description: 'Default 3.' },
      backoff_base_ms: { type: 'number', description: 'Default 5000.' }
    },
    required: ['query']
  },

  async execute(args: { query: string; max_retries?: number; backoff_base_ms?: number }): Promise<ToolResult> {
    try {
      const browser = await connectOrLaunchCDP();
      const contexts = browser.contexts();
      const ctx = contexts[0];
      if (!ctx) return { success: false, output: '', error: 'no browser context' };

      // Bloque 2: STEALTH_INIT_SCRIPT vive ahora en browser_engine.ts y
      // applyStealth es idempotente por contexto.
      await applyStealth(ctx);

      const targetUrl = args.query;
      const maxRetries = args.max_retries ?? 3;
      const backoffBase = args.backoff_base_ms ?? 5000;

      const trace: any[] = [];
      const warmupUrl = getDomainWarmupUrl(targetUrl);

      if (warmupUrl) {
        try {
          const warmPage = await ctx.newPage();
          await warmPage.goto(warmupUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await warmPage.waitForTimeout(2000);
          trace.push({ step: 'warmup', url: warmupUrl, status: 'ok' });
          await warmPage.close();
        } catch (e: any) {
          trace.push({ step: 'warmup', url: warmupUrl, status: 'failed', error: e.message });
        }
      }

      let lastResult: { stdout: string; finalUrl: string; title: string } | null = null;
      let blockedAttempts = 0;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const page = await ctx.newPage();
        try {
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          // Cloudflare a veces tarda en resolver: esperar más en attempts bajos
          await page.waitForTimeout(attempt === 1 ? 6000 : 4000);

          const state = await page.evaluate(() => {
            const body = document.body;
            let bodyText = '';
            if (body) {
              bodyText = ((body as any).innerText || '').replace(/\s+/g, ' ').trim();
              if (bodyText.length > 12000) bodyText = bodyText.slice(0, 12000) + '...[truncated]';
            }
            return { bodyText, title: document.title, finalUrl: window.location.href };
          });

          let stdout = `Navigated to: ${targetUrl}\nFinal URL: ${state.finalUrl}\nPage title: ${state.title}\n\n--- BODY TEXT (${state.bodyText.length} chars) ---\n${state.bodyText}`;

          const block = detectBlock(stdout);
          trace.push({ step: 'navigate', attempt, blocked: block.blocked, signal: block.signal, final_url: state.finalUrl, title: state.title });

          if (!block.blocked) {
            lastResult = { stdout, finalUrl: state.finalUrl, title: state.title };
            break;
          }

          blockedAttempts++;
          await page.close();

          if (attempt < maxRetries) {
            const waitMs = backoffBase * Math.pow(2, attempt - 1);
            trace.push({ step: 'backoff', wait_ms: waitMs });
            await new Promise(r => setTimeout(r, waitMs));
          } else {
            lastResult = { stdout, finalUrl: state.finalUrl, title: state.title };
          }
        } catch (e: any) {
          trace.push({ step: 'navigate_error', attempt, error: e.message });
          try { await page.close(); } catch {}
          if (attempt === maxRetries) {
            return { success: false, output: '', error: `All ${maxRetries} attempts failed. Trace: ${JSON.stringify(trace)}` };
          }
        }
      }

      if (!lastResult) {
        return { success: false, output: '', error: `No result after ${maxRetries} attempts. Trace: ${JSON.stringify(trace)}` };
      }

      const traceSummary = `\n\n--- ANTIBOT TRACE ---\nblocked_attempts: ${blockedAttempts}/${maxRetries}\n${JSON.stringify(trace, null, 2)}`;

      return { success: blockedAttempts < maxRetries, output: lastResult.stdout + traceSummary };
    } catch (err: any) {
      return { success: false, output: '', error: `web_search_with_warmup error: ${err.message}` };
    }
  }
};

registerTool(webSearchWithWarmupTool);
export default webSearchWithWarmupTool;
