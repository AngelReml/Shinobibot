// src/tools/clean_extract.ts
//
// Bloque 2 — tool de alto nivel: dado una URL, navega, extrae el contenido
// principal limpio (sin nav/footer/sidebar/ads) en markdown estructurado, y
// devuelve JSON ready-to-consume por el LLM. Opt-in vision fallback cuando el
// markdown sale demasiado corto y SHINOBI_BROWSER_VISION=1.

import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { connectOrLaunchCDP } from './browser_cdp.js';
import { applyStealth, cleanExtract, visionAnalyze } from './browser_engine.js';

const cleanExtractTool: Tool = {
  name: 'clean_extract',
  description:
    'Navigate to a URL and return the main content as structured markdown (title, content_md, links, images), with optional vision fallback. ' +
    'Strips nav/header/footer/sidebar/ads via DOM heuristics. Use for research-grade content ingestion when you want clean, ready-to-summarise output ' +
    'instead of raw HTML/text dumps. Vision fallback is opt-in via env SHINOBI_BROWSER_VISION=1.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Full URL to extract (must include protocol).' },
      wait_after_load_ms: { type: 'number', description: 'Extra wait after domcontentloaded for late content. Default 3000.' },
      vision_fallback: {
        type: 'boolean',
        description: 'If true AND SHINOBI_BROWSER_VISION=1 AND content_md.length < 200, screenshot the page and call vision LLM via OpenRouter. Default false.',
      },
      vision_question: {
        type: 'string',
        description: 'Question for the vision model when fallback fires. Default "What is this page about? List the main content.".',
      },
    },
    required: ['url'],
  },

  async execute(args: { url: string; wait_after_load_ms?: number; vision_fallback?: boolean; vision_question?: string }): Promise<ToolResult> {
    try {
      if (!/^https?:\/\//i.test(args.url.trim())) {
        return { success: false, output: '', error: `clean_extract requires a full URL with protocol (got "${args.url}")` };
      }

      const browser = await connectOrLaunchCDP();
      const ctx = browser.contexts()[0] || (await browser.newContext());
      await applyStealth(ctx);

      const waitMs = args.wait_after_load_ms ?? 3000;
      const page = await ctx.newPage();
      try {
        await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(waitMs);

        const result = await cleanExtract(page);

        const out: any = { ...result, vision_used: false };

        if (args.vision_fallback && result.char_count < 200) {
          if (process.env.SHINOBI_BROWSER_VISION === '1') {
            const question = args.vision_question || 'What is this page about? List the main content visible on the page.';
            const vision = await visionAnalyze(page, question);
            if (vision.success && vision.analysis) {
              out.vision_used = true;
              out.vision_analysis = vision.analysis;
              out.vision_screenshot = vision.screenshot_path;
              out.vision_model = vision.model;
            } else if (vision.error) {
              out.vision_error = vision.error;
            }
          } else {
            out.vision_skipped = 'SHINOBI_BROWSER_VISION not enabled';
          }
        }

        return { success: true, output: JSON.stringify(out, null, 2) };
      } finally {
        // The page is short-lived (research-style use). Close it so it doesn't
        // pile up in the user's browser. Long-running flows (web_search) keep
        // their pages alive on purpose; this tool is a one-shot extract.
        try { await page.close(); } catch { /* ignore */ }
      }
    } catch (err: any) {
      return { success: false, output: '', error: `clean_extract error: ${err.message}` };
    }
  },
};

registerTool(cleanExtractTool);
export default cleanExtractTool;
