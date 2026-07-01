// F4.4 (2026-07-01) — reader/llm_adapter.ts used to silently substitute gpt-4o
// (or gpt-4o-mini) for the requested Claude logical model whenever
// OPENROUTER_API_KEY was missing, with no log and no audit trail. This test
// proves: (1) without OPENROUTER_API_KEY AND without OPENAI_API_KEY, the
// adapter fails LOUD (throws) instead of silently downgrading; (2) without
// OPENROUTER_API_KEY but WITH OPENAI_API_KEY, the fallback substitution is
// written to the audit log with both the requested and served model names.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { makeLLMClient, NoLLMProviderKeyError } from '../llm_adapter.js';

let tmpDir: string;
let tmpLogPath: string;
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  tmpDir = join(tmpdir(), `shinobi-reader-model-attr-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  tmpLogPath = join(tmpDir, 'audit.jsonl');
  process.env.SHINOBI_AUDIT_LOG_PATH = tmpLogPath;
  delete process.env.SHINOBI_AUDIT_DISABLED;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  vi.restoreAllMocks();
});

function readAuditEvents(): any[] {
  if (!existsSync(tmpLogPath)) return [];
  return readFileSync(tmpLogPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('F4.4 — no silent model downgrade', () => {
  it('no OPENROUTER_API_KEY, no OPENAI_API_KEY → fails loud (throws NoLLMProviderKeyError), never calls out silently', async () => {
    const client = makeLLMClient();
    await expect(
      client.chat([{ role: 'user', content: 'hi' }], { model: 'claude-sonnet-4-6' }),
    ).rejects.toThrow(NoLLMProviderKeyError);
  });

  it('no OPENROUTER_API_KEY, WITH OPENAI_API_KEY → falls back but AUDITS the real model served', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-fake-key-not-real';

    // Stub the HTTP layer so no real network call happens; we only care that
    // the adapter logs the substitution BEFORE/around the call.
    const gatewayModule = await import('../../gateway/llm.js');
    const chatSpy = vi.spyOn(gatewayModule.LLMGateway.prototype, 'chat').mockResolvedValue('stub response');

    const client = makeLLMClient();
    const out = await client.chat([{ role: 'user', content: 'hi' }], { model: 'claude-sonnet-4-6' });
    expect(out).toBe('stub response');

    // The gateway must have been called with the REAL served model (gpt-4o),
    // not the logical name — attribution has to be truthful end-to-end.
    expect(chatSpy).toHaveBeenCalled();
    const callArgs = chatSpy.mock.calls[0][1] as any;
    expect(callArgs.model).toBe('gpt-4o');

    // And the substitution must be present in the audit trail.
    const events = readAuditEvents();
    const failoverEvents = events.filter((e) => e.kind === 'failover');
    expect(failoverEvents.length).toBeGreaterThanOrEqual(1);
    expect(failoverEvents[0].from).toBe('claude-sonnet-4-6');
    expect(failoverEvents[0].to).toBe('gpt-4o');
    expect(String(failoverEvents[0].reason)).toMatch(/OPENROUTER_API_KEY/i);
  });

  it('failLoudOnMissingKeys:false opts out of the throw but the substitution is still audited', async () => {
    const gatewayModule = await import('../../gateway/llm.js');
    vi.spyOn(gatewayModule.LLMGateway.prototype, 'chat').mockResolvedValue('stub response');

    const client = makeLLMClient({ failLoudOnMissingKeys: false });
    const out = await client.chat([{ role: 'user', content: 'hi' }], { model: 'claude-haiku-4-5' });
    expect(out).toBe('stub response');

    const events = readAuditEvents();
    const failoverEvents = events.filter((e) => e.kind === 'failover');
    expect(failoverEvents.length).toBeGreaterThanOrEqual(1);
    expect(failoverEvents[0].from).toBe('claude-haiku-4-5');
    expect(failoverEvents[0].to).toBe('gpt-4o-mini');
  });

  it('with OPENROUTER_API_KEY set, no fallback/substitution is logged (the real path)', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-fake-test-key';
    const gatewayModule = await import('../../gateway/llm.js');
    const chatSpy = vi.spyOn(gatewayModule.LLMGateway.prototype, 'chat').mockResolvedValue('stub response');

    const client = makeLLMClient();
    await client.chat([{ role: 'user', content: 'hi' }], { model: 'claude-sonnet-4-6' });

    const callArgs = chatSpy.mock.calls[0][1] as any;
    expect(callArgs.model).toBe('anthropic/claude-sonnet-4-6');
    expect(callArgs.baseUrl).toMatch(/openrouter/);

    const events = readAuditEvents();
    expect(events.filter((e) => e.kind === 'failover').length).toBe(0);
  });
});
