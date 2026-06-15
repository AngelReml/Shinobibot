/**
 * kangeiko/domains/web/runner.ts — how a web task is executed (KG-03). Injectable:
 * the REAL runner drives the existing browser layer (web_search/CDP) over a closed
 * dojo; the test runner is deterministic. A hard guard wraps ANY runner so an
 * external_effect task (buy/pay/send) is NEVER fired — only documented. ⚑
 */

import type { WebTask } from './arena.js';

export interface WebRunOutcome { outcome: string; executed: boolean; documented_external?: boolean; }
export interface WebRunner { run(task: WebTask): Promise<WebRunOutcome>; }

/**
 * Wrap a runner so external_effect tasks never execute (defense in depth: even a
 * real CDP runner cannot fire a payment). The ⚑ safety line of the web domain.
 */
export function guardExternal(inner: WebRunner): WebRunner {
  return {
    async run(task) {
      if (task.reversibility === 'external_effect') {
        return { outcome: `[documented, NOT fired] ${task.instruction}`, executed: false, documented_external: true };
      }
      return inner.run(task);
    },
  };
}

/** Resolve a dojo://fixtures/X url against a served base url (the local dojo). */
export function resolveDojoUrl(dojoUrl: string, baseUrl: string): string {
  const m = dojoUrl.match(/^dojo:\/\/fixtures\/(.+)$/);
  return m ? `${baseUrl.replace(/\/$/, '')}/${m[1]}` : dojoUrl;
}

function stripTags(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * REAL runner over the LOCAL dojo server: HTTP GET the resolved fixture url and
 * return its visible text as the outcome. No browser needed for static fixtures;
 * fully runnable. (For dynamic/SPA sites, use makeCdpWebRunner.)
 */
export function makeHttpWebRunner(baseUrl: string): WebRunner {
  return {
    async run(task) {
      try {
        const res = await fetch(resolveDojoUrl(task.url, baseUrl));
        if (!res.ok) return { outcome: `HTTP ${res.status}`, executed: true };
        return { outcome: stripTags(await res.text()), executed: true };
      } catch (e: any) {
        return { outcome: `fetch error: ${e.message}`, executed: true };
      }
    },
  };
}

/**
 * REAL runner: navigate the closed-dojo url with the existing web_search tool
 * (CDP) and return the extracted page text as the outcome. Live (needs a browser +
 * the dojo fixtures served). Read-only navigation; never used for external effects
 * (guardExternal blocks those upstream).
 */
export function makeCdpWebRunner(): WebRunner {
  return {
    async run(task) {
      const { getTool } = await import('../../../tools/tool_registry.js');
      const tool = getTool('web_search');
      if (!tool) return { outcome: '', executed: false };
      const r = await tool.execute({ query: task.url });
      return { outcome: String(r.output ?? ''), executed: true };
    },
  };
}
