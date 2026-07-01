// F6.1 (auditoría 2026-07-01, decisión de producto): esta tool documentaba
// su propósito nombrando plataformas concretas de terceros y aplicaba una
// función de anti-detección (spoofing del fingerprint del navegador) —
// evasión anti-bot deliberada, retirada de este producto público (ver
// DECISIONES.md; el código original queda entregado al operador para su
// uso privado). Lo que queda es robustez de navegación legítima: warm-up
// request + detección de bloqueo + backoff exponencial — SIN spoofing de
// fingerprint. Cualquier navegador automatizado, por honesto que sea, puede
// toparse con un bloqueo transitorio y beneficiarse de un reintento con
// backoff.
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { connectOrLaunchCDP } from './browser_cdp.js';
import { requestNavigationConsent, rememberNavigatedHost } from '../browser/consent.js';

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
  description: 'Resilient navigation for sites that may transiently block automated requests: warm-up request to /robots.txt, then retry with exponential backoff, detecting common block signals (rate-limit / verification pages). Does NOT spoof browser fingerprint. Use when a plain navigation attempt is likely to hit a transient block and a retry with backoff is appropriate.',
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
    // F1.3 (auditoría 2026-07, RANK #4): misma clase de bypass que
    // web_search.ts — esta tool navega directo vía CDP sin gate. Aquí el
    // destino es explícito (args.query es SIEMPRE la URL completa, ver su
    // propio schema de parámetros), así que el gate es directo.
    const navConsent = await requestNavigationConsent(args.query);
    if (!navConsent.allowed) {
      return { success: false, output: '', error: `Navegación no permitida (${navConsent.reason}). No se navegó.` };
    }
    await rememberNavigatedHost(args.query);
    try {
      const browser = await connectOrLaunchCDP();
      const contexts = browser.contexts();
      const ctx = contexts[0];
      if (!ctx) return { success: false, output: '', error: 'no browser context' };

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
