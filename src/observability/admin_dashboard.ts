/**
 * Admin Dashboard — handlers HTTP que sirven el dashboard en
 * `/admin/dashboard` + `/admin/metrics/json` + `/admin/metrics/prom`.
 * Sprint 2.4.
 *
 * Se exportan funciones puras que toman `request → response`, sin
 * acoplar a Express. El caller (src/web/server.ts) los monta.
 *
 * El HTML es estático con un poll cada 2s a `/admin/metrics/json` para
 * actualizar los counters en vivo. Sin frameworks JS — vanilla.
 */

import { metrics } from './metrics.js';
import { alertRouter } from './alerts.js';
import { failoverCooldownMetrics } from '../providers/provider_router.js';

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Shinobi · Admin Dashboard</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #0c0a08; color: #e5e0d6; padding: 24px; margin: 0; }
  h1 { color: #6b150c; margin: 0 0 16px; font-size: 18px; font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .card { background: #1a1612; border: 1px solid #2a2420; border-radius: 6px; padding: 12px 14px; }
  .card .label { color: #a39c8e; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
  .card .value { font-size: 22px; font-family: 'JetBrains Mono', monospace; margin-top: 4px; }
  .card .sub { color: #6b6358; font-size: 11px; margin-top: 6px; }
  .section { margin-top: 24px; }
  pre { background: #1a1612; border: 1px solid #2a2420; border-radius: 6px; padding: 12px; overflow-x: auto; font-size: 11px; line-height: 1.5; }
  a { color: #b97a4a; }
</style>
</head>
<body>
<h1>Shinobi · Admin Dashboard</h1>
<div class="section">
  <div class="grid" id="counters"></div>
</div>
<div class="section">
  <h1>Histograms</h1>
  <pre id="histograms">cargando…</pre>
</div>
<div class="section">
  <h1>Alertas activas</h1>
  <pre id="alerts">cargando…</pre>
</div>
<div class="section">
  <p style="color:#6b6358;font-size:11px">
    JSON: <a href="/admin/metrics/json">/admin/metrics/json</a> ·
    Prometheus: <a href="/admin/metrics/prom">/admin/metrics/prom</a> ·
    Refresca cada 2s.
  </p>
</div>
<script>
async function refresh() {
  try {
    const r = await fetch('/admin/metrics/json', { cache: 'no-store' });
    const snap = await r.json();
    const counters = [];
    const hists = [];
    for (const [name, m] of Object.entries(snap.metrics ?? {})) {
      if (m.type === 'counter' || m.type === 'gauge') {
        for (const v of m.values) {
          const sub = Object.keys(v.labels).length ? JSON.stringify(v.labels) : '';
          counters.push(\`<div class="card"><div class="label">\${m.type} · \${name}</div><div class="value">\${v.value.toLocaleString()}</div><div class="sub">\${sub}</div></div>\`);
        }
      } else if (m.type === 'histogram') {
        for (const s of m.series) {
          hists.push(\`\${name}  count=\${s.count}  sum=\${s.sum.toFixed(2)}  buckets=\${JSON.stringify(s.bucketCounts)}\`);
        }
      }
    }
    document.getElementById('counters').innerHTML = counters.join('') || '<div class="card"><div class="label">sin métricas</div><div class="value">—</div></div>';
    document.getElementById('histograms').textContent = hists.join('\\n') || '(no hay histogramas)';
    document.getElementById('alerts').textContent = JSON.stringify(snap.alerts ?? [], null, 2);
  } catch (e) {
    document.getElementById('counters').innerHTML = '<div class="card"><div class="label">error</div><div class="value">⚠</div><div class="sub">'+e+'</div></div>';
  }
}
refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>`;

export function renderDashboardHtml(): { contentType: string; body: string } {
  return { contentType: 'text/html; charset=utf-8', body: DASHBOARD_HTML };
}

export function snapshotJsonResponse(): { contentType: string; body: string } {
  const reg = metrics();
  const router = alertRouter();
  const payload = {
    ts: new Date().toISOString(),
    metrics: reg.snapshotJson(),
    alerts: router.list().map(r => ({ id: r.id, kind: r.kind, target: r.target })),
    failover_cooldown: failoverCooldownMetrics(),
  };
  return { contentType: 'application/json', body: JSON.stringify(payload, null, 2) };
}

export function prometheusResponse(): { contentType: string; body: string } {
  return {
    contentType: 'text/plain; version=0.0.4',
    body: metrics().exportPrometheus(),
  };
}
