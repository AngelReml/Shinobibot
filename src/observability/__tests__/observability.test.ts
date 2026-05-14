import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsRegistry, metrics, _resetMetrics } from '../metrics.js';
import { AlertRouter, alertRouter, _resetAlertRouter, type AlertRule } from '../alerts.js';
import { renderDashboardHtml, snapshotJsonResponse, prometheusResponse } from '../admin_dashboard.js';

beforeEach(() => {
  _resetMetrics();
  _resetAlertRouter();
});

describe('MetricsRegistry — counters', () => {
  it('counterInc acumula valores', () => {
    const r = new MetricsRegistry();
    r.counterInc('foo');
    r.counterInc('foo');
    r.counterInc('foo', 3);
    const j = r.snapshotJson();
    expect(j.foo.type).toBe('counter');
    expect(j.foo.values[0].value).toBe(5);
  });

  it('counter con labels separa series', () => {
    const r = new MetricsRegistry();
    r.counterInc('tool_calls', 1, { tool: 'read_file' });
    r.counterInc('tool_calls', 2, { tool: 'write_file' });
    r.counterInc('tool_calls', 1, { tool: 'read_file' });
    const j = r.snapshotJson();
    expect(j.tool_calls.values).toHaveLength(2);
    const read = j.tool_calls.values.find((v: any) => v.labels.tool === 'read_file');
    expect(read.value).toBe(2);
  });

  it('counter no permite valores negativos', () => {
    const r = new MetricsRegistry();
    expect(() => r.counterInc('x', -1)).toThrow();
  });
});

describe('MetricsRegistry — gauges', () => {
  it('gaugeSet sobrescribe', () => {
    const r = new MetricsRegistry();
    r.gaugeSet('temperature', 23.5);
    r.gaugeSet('temperature', 24.0);
    const j = r.snapshotJson();
    expect(j.temperature.values[0].value).toBe(24.0);
  });

  it('gaugeInc/Dec con delta', () => {
    const r = new MetricsRegistry();
    r.gaugeInc('queue_size', 5);
    r.gaugeInc('queue_size', 3);
    r.gaugeInc('queue_size', -2);
    const j = r.snapshotJson();
    expect(j.queue_size.values[0].value).toBe(6);
  });
});

describe('MetricsRegistry — histogram', () => {
  it('histogramObserve actualiza buckets, sum, count', () => {
    const r = new MetricsRegistry();
    r.describeHistogram('latency_ms', { buckets: [10, 100, 1000] });
    r.histogramObserve('latency_ms', 5);    // bucket 10
    r.histogramObserve('latency_ms', 50);   // bucket 100
    r.histogramObserve('latency_ms', 500);  // bucket 1000
    r.histogramObserve('latency_ms', 5000); // +Inf
    const j = r.snapshotJson();
    const s = j.latency_ms.series[0];
    expect(s.count).toBe(4);
    expect(s.sum).toBe(5555);
    // bucketCounts cumulativos para [10, 100, 1000] + +Inf
    expect(s.bucketCounts[0]).toBe(1); // <= 10
    expect(s.bucketCounts[1]).toBe(2); // <= 100
    expect(s.bucketCounts[2]).toBe(3); // <= 1000
    expect(s.bucketCounts[3]).toBe(4); // <= +Inf
  });

  it('histogramObserve sin describe → lanza', () => {
    const r = new MetricsRegistry();
    expect(() => r.histogramObserve('x', 1)).toThrow();
  });
});

describe('MetricsRegistry — prometheus export', () => {
  it('exporta counter sin labels', () => {
    const r = new MetricsRegistry();
    r.describeCounter('foo', 'foo help');
    r.counterInc('foo', 7);
    const text = r.exportPrometheus();
    expect(text).toContain('# HELP foo foo help');
    expect(text).toContain('# TYPE foo counter');
    expect(text).toContain('foo 7');
  });

  it('exporta gauge con labels y escape', () => {
    const r = new MetricsRegistry();
    r.gaugeSet('items', 3, { source: 'cli' });
    const text = r.exportPrometheus();
    expect(text).toMatch(/items\{source="cli"\}\s+3/);
  });

  it('exporta histogram con buckets le + sum + count', () => {
    const r = new MetricsRegistry();
    r.describeHistogram('lat', { buckets: [10, 100] });
    r.histogramObserve('lat', 5);
    r.histogramObserve('lat', 50);
    const text = r.exportPrometheus();
    expect(text).toContain('lat_bucket{le="10"} 1');
    expect(text).toContain('lat_bucket{le="100"} 2');
    expect(text).toContain('lat_bucket{le="+Inf"} 2');
    expect(text).toContain('lat_sum 55');
    expect(text).toContain('lat_count 2');
  });

  it('escapa valores de label con comillas', () => {
    const r = new MetricsRegistry();
    r.gaugeSet('x', 1, { msg: 'a"b' });
    expect(r.exportPrometheus()).toMatch(/msg="a\\"b"/);
  });
});

describe('AlertRouter — event_count', () => {
  it('dispara cuando se alcanza el umbral en la ventana', async () => {
    const r = new AlertRouter();
    const sent: any[] = [];
    r.sender = async (url, body) => { sent.push({ url, body }); return { ok: true }; };
    r.register({
      id: 'many_loop_aborts',
      kind: 'event_count',
      target: 'loop_abort',
      threshold: 3,
      windowSec: 60,
      cooldownSec: 0,
      webhookUrl: 'https://hooks/test',
    });
    await r.onEvent({ kind: 'loop_abort' });
    await r.onEvent({ kind: 'loop_abort' });
    expect(sent).toHaveLength(0);
    const outs = await r.onEvent({ kind: 'loop_abort' });
    expect(outs[0].fired).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('cooldown impide re-disparo dentro del periodo', async () => {
    const r = new AlertRouter();
    let calls = 0;
    r.sender = async () => { calls++; return { ok: true }; };
    r.register({
      id: 'dup_fire',
      kind: 'event_count',
      target: 'x',
      threshold: 1,
      windowSec: 60,
      cooldownSec: 60,
      webhookUrl: 'https://hooks/test',
    });
    await r.onEvent({ kind: 'x' });
    await r.onEvent({ kind: 'x' });
    expect(calls).toBe(1);
  });
});

describe('AlertRouter — event_match', () => {
  it('matchea payload contains', async () => {
    const r = new AlertRouter();
    const sent: any[] = [];
    r.sender = async (_u, body) => { sent.push(body); return { ok: true }; };
    r.register({
      id: 'destructive',
      kind: 'event_match',
      target: 'tool_call',
      match: 'rm -rf',
      webhookUrl: 'https://hooks/test',
      cooldownSec: 0,
    });
    await r.onEvent({ kind: 'tool_call', payload: { command: 'ls' } });
    expect(sent).toHaveLength(0);
    await r.onEvent({ kind: 'tool_call', payload: { command: 'rm -rf /' } });
    expect(sent).toHaveLength(1);
  });
});

describe('AlertRouter — metric_above', () => {
  it('dispara cuando el valor supera el threshold', async () => {
    const r = new AlertRouter();
    const sent: any[] = [];
    r.sender = async (_u, body) => { sent.push(body); return { ok: true }; };
    r.register({
      id: 'cost_high',
      kind: 'metric_above',
      target: 'cost_total_usd',
      valueAbove: 10,
      webhookUrl: 'https://hooks/test',
      cooldownSec: 0,
    });
    const out1 = await r.evaluateMetric('cost_total_usd', 5);
    expect(out1[0].fired).toBe(false);
    const out2 = await r.evaluateMetric('cost_total_usd', 12);
    expect(out2[0].fired).toBe(true);
  });
});

describe('AlertRouter — webhook failure', () => {
  it('error en sender NO lanza, marca fired=false', async () => {
    const r = new AlertRouter();
    r.sender = async () => ({ ok: false, error: 'connection refused' });
    r.register({
      id: 'x',
      kind: 'event_count',
      target: 'x',
      threshold: 1,
      cooldownSec: 0,
      webhookUrl: 'https://hooks/test',
    });
    const out = await r.onEvent({ kind: 'x' });
    expect(out[0].fired).toBe(false);
    expect(out[0].reason).toContain('webhook failed');
  });
});

describe('Admin dashboard handlers', () => {
  it('renderDashboardHtml devuelve HTML válido', () => {
    const r = renderDashboardHtml();
    expect(r.contentType).toContain('text/html');
    expect(r.body).toContain('<title>Shinobi · Admin Dashboard</title>');
    expect(r.body).toContain('/admin/metrics/json');
  });

  it('snapshotJsonResponse parsea como JSON', () => {
    metrics().counterInc('demo', 5);
    const r = snapshotJsonResponse();
    expect(r.contentType).toBe('application/json');
    const parsed = JSON.parse(r.body);
    expect(parsed.metrics.demo).toBeTruthy();
    expect(parsed.alerts).toEqual([]);
  });

  it('snapshotJsonResponse incluye reglas registradas', () => {
    alertRouter().register({
      id: 'test', kind: 'event_count', target: 'x',
      threshold: 1, windowSec: 60, webhookUrl: 'https://w',
    });
    const r = JSON.parse(snapshotJsonResponse().body);
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0].id).toBe('test');
  });

  it('prometheusResponse devuelve text/plain', () => {
    metrics().counterInc('foo', 3);
    const r = prometheusResponse();
    expect(r.contentType).toContain('text/plain');
    expect(r.body).toContain('foo 3');
  });
});
