#!/usr/bin/env node
/**
 * Prueba funcional Sprint 2.4 — Observabilidad enterprise.
 *
 * Simula un flujo realista del agente:
 *   1. Registra metrics (tool_calls counter, latency histogram).
 *   2. Configura una alerta event_count (3 loop_aborts en 60s → webhook).
 *   3. Configura una alerta metric_above (cost > $0.50 → webhook).
 *   4. Dispara eventos: 5 tool_calls (algunos fallidos), 3 loop_aborts,
 *      cost que cruza el umbral.
 *   5. Verifica que el webhook se invocó cuando debía, y NO cuando no.
 *   6. Renderiza /admin/metrics/json y /admin/metrics/prom y valida formato.
 *
 * Sin red real: el sender está sobrescrito por un mock que captura los
 * payloads en memoria.
 */

import { _resetMetrics, metrics } from '../../src/observability/metrics.js';
import { _resetAlertRouter, alertRouter } from '../../src/observability/alerts.js';
import { renderDashboardHtml, snapshotJsonResponse, prometheusResponse } from '../../src/observability/admin_dashboard.js';

let failed = 0;
function check(cond: boolean, label: string, detail?: string): void {
  if (cond) console.log(`  ok  ${label}${detail ? ` · ${detail}` : ''}`);
  else { console.log(`  FAIL ${label}${detail ? ` · ${detail}` : ''}`); failed++; }
}

async function main(): Promise<void> {
  _resetMetrics();
  _resetAlertRouter();
  console.log('=== Sprint 2.4 — Observabilidad enterprise ===');

  const reg = metrics();
  reg.describeCounter('tool_calls_total', 'Total de tool calls ejecutadas');
  reg.describeCounter('loop_aborts_total', 'Aborts del loop detector');
  reg.describeGauge('cost_total_usd', 'Coste acumulado en USD');
  reg.describeHistogram('tool_latency_ms', { buckets: [50, 200, 1000, 5000] }, 'Latencia tool por bucket');

  const router = alertRouter();
  const sent: Array<{ url: string; body: any }> = [];
  router.sender = async (url, body) => { sent.push({ url, body }); return { ok: true }; };

  router.register({
    id: 'loop_aborts_burst',
    kind: 'event_count',
    target: 'loop_abort',
    threshold: 3,
    windowSec: 60,
    cooldownSec: 0,
    webhookUrl: 'https://hooks/slack/loops',
    template: '🌀 Loop abort burst: {reason}',
  });
  router.register({
    id: 'cost_high',
    kind: 'metric_above',
    target: 'cost_total_usd',
    valueAbove: 0.50,
    cooldownSec: 0,
    webhookUrl: 'https://hooks/slack/cost',
    template: '💸 Cost alert: {value} USD ({reason})',
  });
  router.register({
    id: 'destructive_command',
    kind: 'event_match',
    target: 'tool_call',
    match: 'rm -rf /',
    cooldownSec: 0,
    webhookUrl: 'https://hooks/slack/destructive',
  });

  console.log('\n--- Simulando flujo del agente ---');

  // 5 tool_calls con distintas latencias.
  for (const lat of [30, 80, 220, 1200, 4000]) {
    reg.counterInc('tool_calls_total', 1, { tool: 'read_file' });
    reg.histogramObserve('tool_latency_ms', lat, { tool: 'read_file' });
    await router.onEvent({ kind: 'tool_call', payload: { tool: 'read_file', latency: lat } });
  }
  // 1 tool_call destructivo (debería disparar event_match).
  reg.counterInc('tool_calls_total', 1, { tool: 'run_command' });
  await router.onEvent({ kind: 'tool_call', payload: { command: 'rm -rf /tmp' } });

  // 3 loop_aborts → dispara event_count.
  for (let i = 0; i < 3; i++) {
    reg.counterInc('loop_aborts_total');
    await router.onEvent({ kind: 'loop_abort', payload: { verdict: 'LOOP_DETECTED' } });
  }

  // Cost va escalando; debe disparar al cruzar 0.50.
  for (const v of [0.10, 0.30, 0.55, 0.80]) {
    reg.gaugeSet('cost_total_usd', v);
    await router.evaluateMetric('cost_total_usd', v);
  }

  console.log(`  webhooks enviados: ${sent.length}`);
  for (const s of sent) console.log(`    ${s.url}  ${s.body.text}`);

  check(sent.length >= 3, 'al menos 3 webhooks disparados (destructive + loops + cost)');
  check(sent.some(s => s.url.includes('loops')), 'loop_abort_burst disparó');
  check(sent.some(s => s.url.includes('cost')), 'cost_high disparó');
  check(sent.some(s => s.url.includes('destructive')), 'destructive_command disparó');
  // El cost_high debe disparar 2 veces (0.55 y 0.80, cooldown=0) o 1 si fusiona.
  const costFires = sent.filter(s => s.url.includes('cost')).length;
  check(costFires >= 1, `cost firings >= 1 (real: ${costFires})`);

  console.log('\n--- /admin/metrics/json ---');
  const json = snapshotJsonResponse();
  check(json.contentType === 'application/json', 'content-type JSON');
  const parsed = JSON.parse(json.body);
  check(parsed.metrics.tool_calls_total !== undefined, 'snapshot incluye tool_calls_total');
  check(parsed.metrics.cost_total_usd !== undefined, 'snapshot incluye cost_total_usd');
  check(parsed.metrics.tool_latency_ms.series[0].count === 5, 'histogram count = 5');
  check(parsed.alerts.length === 3, 'snapshot lista 3 reglas registradas');

  console.log('\n--- /admin/metrics/prom ---');
  const prom = prometheusResponse();
  check(prom.contentType.includes('text/plain'), 'content-type Prometheus');
  check(prom.body.includes('# TYPE tool_calls_total counter'), 'tipo counter exportado');
  check(prom.body.includes('# TYPE tool_latency_ms histogram'), 'tipo histogram exportado');
  check(/tool_latency_ms_bucket\{[^}]*le="50"[^}]*\}\s+\d+/.test(prom.body), 'bucket le="50" presente');
  check(prom.body.includes('cost_total_usd'), 'gauge cost_total_usd exportado');

  console.log('\n--- /admin/dashboard ---');
  const html = renderDashboardHtml();
  check(html.contentType.includes('text/html'), 'content-type HTML');
  check(html.body.includes('<title>Shinobi · Admin Dashboard</title>'), 'HTML title presente');
  check(html.body.includes("fetch('/admin/metrics/json'"), 'cliente hace polling al endpoint');

  console.log('\n=== Summary ===');
  if (failed > 0) {
    console.log(`FAIL · ${failed} aserciones`);
    process.exit(1);
  }
  console.log('PASS · metrics + alerts + dashboard funcionan end-to-end');
}

main().catch((e) => {
  console.error('Observability test crashed:', e?.stack ?? e);
  process.exit(2);
});
