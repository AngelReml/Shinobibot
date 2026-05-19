import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { metrics, _resetMetrics } from '../metrics.js';

describe('LLM Execution Telemetry Metrics', () => {
  beforeEach(() => {
    _resetMetrics();
  });

  afterEach(() => {
    _resetMetrics();
  });

  it('correctly registers LLM calls counter', () => {
    const reg = metrics();
    reg.counterInc('shinobi_llm_calls_total', 1, { provider: 'openai', model: 'gpt-4o-mini' });
    reg.counterInc('shinobi_llm_calls_total', 1, { provider: 'openai', model: 'gpt-4o-mini' });
    reg.counterInc('shinobi_llm_calls_total', 1, { provider: 'anthropic', model: 'claude-haiku-4.5' });

    const snap = reg.snapshotJson();
    expect(snap.shinobi_llm_calls_total).toBeDefined();
    expect(snap.shinobi_llm_calls_total.values).toHaveLength(2);

    const openaiVal = snap.shinobi_llm_calls_total.values.find((v: any) => v.labels.provider === 'openai');
    expect(openaiVal.value).toBe(2);

    const anthropicVal = snap.shinobi_llm_calls_total.values.find((v: any) => v.labels.provider === 'anthropic');
    expect(anthropicVal.value).toBe(1);
  });

  it('correctly records prompt and completion token counts', () => {
    const reg = metrics();
    reg.counterInc('shinobi_llm_tokens_total', 150, { provider: 'openai', model: 'gpt-4o-mini', type: 'prompt' });
    reg.counterInc('shinobi_llm_tokens_total', 50, { provider: 'openai', model: 'gpt-4o-mini', type: 'completion' });

    const snap = reg.snapshotJson();
    const values = snap.shinobi_llm_tokens_total.values;
    expect(values).toHaveLength(2);

    const promptVal = values.find((v: any) => v.labels.type === 'prompt');
    const completionVal = values.find((v: any) => v.labels.type === 'completion');

    expect(promptVal.value).toBe(150);
    expect(completionVal.value).toBe(50);
  });

  it('correctly populates duration histogram and exports to Prometheus format', () => {
    const reg = metrics();
    reg.describeHistogram('shinobi_llm_duration_seconds', { buckets: [0.1, 0.5, 1.0, 5.0] }, 'LLM call duration');
    reg.histogramObserve('shinobi_llm_duration_seconds', 0.35, { provider: 'openai', model: 'gpt-4o-mini' });
    reg.histogramObserve('shinobi_llm_duration_seconds', 2.5, { provider: 'openai', model: 'gpt-4o-mini' });

    const prom = reg.exportPrometheus();
    expect(prom).toContain('shinobi_llm_duration_seconds_bucket{le="0.5",model="gpt-4o-mini",provider="openai"} 1');
    expect(prom).toContain('shinobi_llm_duration_seconds_bucket{le="1",model="gpt-4o-mini",provider="openai"} 1');
    expect(prom).toContain('shinobi_llm_duration_seconds_bucket{le="5",model="gpt-4o-mini",provider="openai"} 2');
    expect(prom).toContain('shinobi_llm_duration_seconds_bucket{le="+Inf",model="gpt-4o-mini",provider="openai"} 2');
    expect(prom).toContain('shinobi_llm_duration_seconds_sum{model="gpt-4o-mini",provider="openai"} 2.85');
    expect(prom).toContain('shinobi_llm_duration_seconds_count{model="gpt-4o-mini",provider="openai"} 2');
  });
});
