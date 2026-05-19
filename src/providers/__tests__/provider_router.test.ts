import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeLLM, failoverCooldown } from '../provider_router.js';
import { groqClient } from '../groq_client.js';
import { openaiClient } from '../openai_client.js';
import { anthropicClient } from '../anthropic_client.js';
import { openrouterClient } from '../openrouter_client.js';

describe('provider_router failover and cooldown integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    failoverCooldown()._resetForTests();
    delete process.env.SHINOBI_FAILOVER_CHAIN;
    delete process.env.SHINOBI_PROVIDER;
  });

  it('rotates to next provider if primary fails', async () => {
    // Mock primary (openai) to fail with rate_limit, secondary (groq) to succeed
    const spyOpenAI = vi.spyOn(openaiClient, 'invokeLLM').mockResolvedValue({
      success: false,
      output: '',
      error: 'OpenAI HTTP 429: Too Many Requests',
    });
    const spyGroq = vi.spyOn(groqClient, 'invokeLLM').mockResolvedValue({
      success: true,
      output: '{"role":"assistant","content":"hello"}',
      error: '',
    });

    process.env.SHINOBI_FAILOVER_CHAIN = 'openai,groq';
    process.env.SHINOBI_PROVIDER = 'openai';

    const res = await invokeLLM({ messages: [{ role: 'user', content: 'test' }] });
    expect(res.success).toBe(true);
    expect(spyOpenAI).toHaveBeenCalledTimes(1);
    expect(spyGroq).toHaveBeenCalledTimes(1);
  });

  it('respects cooldown and skips cooling-down providers', async () => {
    // Put openai in cooldown
    const cd = failoverCooldown();
    cd.markFailure('openai', 'rate_limit');
    cd.markFailure('openai', 'rate_limit');
    cd.markFailure('openai', 'rate_limit'); // threshold reached (3)

    expect(cd.isAvailable('openai')).toBe(false);

    const spyOpenAI = vi.spyOn(openaiClient, 'invokeLLM');
    const spyGroq = vi.spyOn(groqClient, 'invokeLLM').mockResolvedValue({
      success: true,
      output: '{"role":"assistant","content":"hello from groq"}',
      error: '',
    });

    process.env.SHINOBI_FAILOVER_CHAIN = 'openai,groq';
    process.env.SHINOBI_PROVIDER = 'openai';

    const res = await invokeLLM({ messages: [{ role: 'user', content: 'test' }] });
    expect(res.success).toBe(true);
    expect(spyOpenAI).not.toHaveBeenCalled();
    expect(spyGroq).toHaveBeenCalledTimes(1);
  });
});
