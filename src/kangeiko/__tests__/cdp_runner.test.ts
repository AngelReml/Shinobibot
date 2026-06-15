import { describe, it, expect, vi } from 'vitest';
import { makeCdpWebRunner, guardExternal } from '../domains/web/runner.js';
import { tagTask } from '../domains/web/arena.js';
import { makeWebDomain } from '../domains/web/domain.js';
import { runKangeiko } from '../loop.js';

/**
 * CDP runner wiring for the OPEN WEB, tested without a browser via an injected
 * navigator. The default navigator drives the real web_search/CDP tool; here we
 * inject one to prove the wiring: real urls pass through, dojo:// resolves,
 * external_effect tasks are never even opened, and the loop self-improves over it.
 */

describe('makeCdpWebRunner — open-web wiring (read-only navigate + extract)', () => {
  it('passes a real http url to the navigator verbatim and maps its output', async () => {
    const navigate = vi.fn(async (url: string) => ({ output: `PAGE(${url}): Attention Is All You Need`, success: true }));
    const runner = makeCdpWebRunner({ navigate });
    const task = tagTask({ task_id: 't', capability_id: 'web.read.title', instruction: 'read the title', url: 'https://arxiv.org/abs/1706.03762', oracle: 'Attention Is All You Need' });
    const r = await runner.run(task);
    expect(navigate).toHaveBeenCalledWith('https://arxiv.org/abs/1706.03762');
    expect(r.outcome).toContain('Attention Is All You Need');
    expect(r.executed).toBe(true);
  });

  it('resolves dojo:// against dojoBaseUrl, and caps extracted text', async () => {
    const navigate = vi.fn(async () => ({ output: 'x'.repeat(50_000), success: true }));
    const runner = makeCdpWebRunner({ navigate, dojoBaseUrl: 'http://127.0.0.1:8080', extractChars: 100 });
    const r = await runner.run(tagTask({ task_id: 't', capability_id: 'c', instruction: 'read', url: 'dojo://fixtures/article.html', oracle: 'x' }));
    expect(navigate).toHaveBeenCalledWith('http://127.0.0.1:8080/article.html');
    expect(r.outcome.length).toBe(100);
  });

  it('⚑ an external_effect task is NEVER navigated (guard) — documented only', async () => {
    const navigate = vi.fn(async () => ({ output: 'should not happen', success: true }));
    const runner = guardExternal(makeCdpWebRunner({ navigate }));
    const pay = tagTask({ task_id: 'pay', capability_id: 'web.act.checkout', instruction: 'buy the item now', url: 'https://shop.example.com/checkout', oracle: 'order placed' });
    const r = await runner.run(pay);
    expect(navigate).not.toHaveBeenCalled();          // the browser never even opened it
    expect(r.executed).toBe(false);
    expect(r.documented_external).toBe(true);
  });

  it('drives the self-improvement loop over the open web (injected navigator)', async () => {
    // navigator returns the oracle for the read task → certify proves against it.
    const navigate = async (url: string) => ({ output: url.includes('arxiv') ? 'Attention Is All You Need' : '(blank)', success: true });
    const arena = [tagTask({ task_id: 't', capability_id: 'web.read.title', instruction: 'read the paper title', url: 'https://arxiv.org/abs/1706.03762', oracle: 'Attention Is All You Need' })];
    const dom = makeWebDomain(arena, makeCdpWebRunner({ navigate }), { baseline: [] });
    const res = await runKangeiko(dom, { maxCycles: 2, maxTokens: 10_000, maxSkillsPerCycle: 2 });
    expect(res.rising).toBe(true);
    expect(dom.repertoireView()).toContain('web.read.title');
  });
});
