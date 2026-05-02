import { type Tool, type ToolResult, registerTool } from './tool_registry.js';

const BLOCK_SIGNALS = [
  /it needs a human touch/i,
  /pxcr\d+/i,
  /just a moment/i,
  /attention required/i,
  /cf-please-wait/i,
  /verifying you are human/i,
  /access denied/i,
  /\/checkpoint/i,
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
  description: 'Like web_search but with anti-bot mitigation: performs a warm-up request to robots.txt, then the real navigation, with retry on detected block signals (CAPTCHA, Cloudflare, etc). Use this for sites known to gate first requests (Fiverr, Upwork, LinkedIn).',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'URL to navigate to. Must be a full URL (https://...).'
      },
      max_retries: {
        type: 'number',
        description: 'Maximum retries on block detection. Default 3.'
      },
      backoff_base_ms: {
        type: 'number',
        description: 'Base milliseconds for exponential backoff. Default 5000.'
      }
    },
    required: ['query']
  },

  async execute(args: { query: string; max_retries?: number; backoff_base_ms?: number }): Promise<ToolResult> {
    try {
      const { chromium } = await import('playwright');
      const browser = await chromium.connectOverCDP('http://localhost:9222');
      const contexts = browser.contexts();
      const ctx = contexts[0];
      if (!ctx) return { success: false, output: '', error: 'no browser context' };

      const targetUrl = args.query;
      const maxRetries = args.max_retries ?? 3;
      const backoffBase = args.backoff_base_ms ?? 5000;

      // PASO 1: Warm-up — petición a robots.txt para "calentar" la sesión sin disparar el detector
      const warmupUrl = getDomainWarmupUrl(targetUrl);
      const trace: any[] = [];

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

      // PASO 2: Navegación real con retry
      let lastResult: { stdout: string; finalUrl: string; title: string; pageRef: any } | null = null;
      let blockedAttempts = 0;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const page = await ctx.newPage();
        try {
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
          await page.waitForTimeout(3000);

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
          trace.push({ step: 'navigate', attempt, blocked: block.blocked, signal: block.signal, final_url: state.finalUrl });

          if (!block.blocked) {
            // Éxito limpio
            lastResult = { stdout, finalUrl: state.finalUrl, title: state.title, pageRef: page };
            break;
          }

          blockedAttempts++;
          await page.close();

          if (attempt < maxRetries) {
            const waitMs = backoffBase * Math.pow(2, attempt - 1);
            trace.push({ step: 'backoff', wait_ms: waitMs });
            await new Promise(r => setTimeout(r, waitMs));
          } else {
            // Última iteración bloqueada: aún así devolver lo que tenemos para diagnóstico
            lastResult = { stdout, finalUrl: state.finalUrl, title: state.title, pageRef: null };
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
        return { success: false, output: '', error: `No successful navigation after ${maxRetries} attempts. Trace: ${JSON.stringify(trace)}` };
      }

      const traceSummary = `\n\n--- ANTIBOT TRACE ---\nblocked_attempts: ${blockedAttempts}/${maxRetries}\n${JSON.stringify(trace, null, 2)}`;

      return { success: blockedAttempts < maxRetries, output: lastResult.stdout + traceSummary };
    } catch (err: any) {
      if (err.message?.includes('ECONNREFUSED')) {
        return { success: false, output: '', error: 'No browser on port 9222.' };
      }
      return { success: false, output: '', error: `web_search_with_warmup error: ${err.message}` };
    }
  }
};

registerTool(webSearchWithWarmupTool);
export default webSearchWithWarmupTool;
