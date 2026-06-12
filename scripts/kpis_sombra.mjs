#!/usr/bin/env node
// KPIs N0 de la sombra (PLAN_SOMBRA §4.3) — medición interna desde el rastro real.
// Lee audit.jsonl (tool calls) + ledger/chain.jsonl (misiones) y emite la tabla
// semanal en markdown por stdout. Node puro, cero deps, cross-platform.
//
// Uso:  node scripts/kpis_sombra.mjs [raizDelRepo]
//
// Honestidad de los proxies (no confundir con lo que aun no se mide):
//  - "exito de tool" es un PROXY de "exito sin intervencion": mide la tool, no
//    la mision. El KPI real llega cuando el ledger registre intervencion humana.
//  - "interrupciones del candado" solo aparecera cuando el audit registre kinds
//    de aprobacion; el script los detecta dinamicamente si existen.

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.argv[2] || process.cwd();

function isoWeek(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return '????';
  const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = u.getUTCDay() || 7;
  u.setUTCDate(u.getUTCDate() + 4 - day);
  const y = u.getUTCFullYear();
  const w = Math.ceil(((u - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return y + '-W' + String(w).padStart(2, '0');
}

function readJsonl(p) {
  if (!existsSync(p)) return [];
  const out = [];
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* linea corrupta: se ignora, se cuenta */ out.corrupt = (out.corrupt || 0) + 1; }
  }
  return out;
}

// ── audit.jsonl ──
const audit = readJsonl(join(ROOT, 'audit.jsonl'));
const byKind = {};
const weeks = {}; // week -> stats
for (const e of audit) {
  byKind[e.kind || '?'] = (byKind[e.kind || '?'] || 0) + 1;
  if (e.kind !== 'tool_call') continue;
  const w = isoWeek(e.ts);
  const s = (weeks[w] ||= { calls: 0, ok: 0, fail: 0, tools: {}, errs: {}, sessions: new Set(), ms: 0 });
  s.calls++;
  e.success ? s.ok++ : s.fail++;
  s.tools[e.tool] = (s.tools[e.tool] || 0) + 1;
  if (e.error) { const k = String(e.error).slice(0, 38); s.errs[k] = (s.errs[k] || 0) + 1; }
  if (e.sessionId) s.sessions.add(e.sessionId);
  s.ms += e.durationMs || 0;
}
const approvalKinds = Object.keys(byKind).filter(k => /approv|gate|candado|permission/i.test(k));
// El candado hoy NO emite kind propio: aparece como error de un tool_call frenado.
// Se detecta por patron sobre el campo error (instrumentar kind propio en G1).
const RE_CANDADO = /approval_denied|rechazad|no permitid|denegad|not permitted|requires approval/i;
let candadoHits = 0;
for (const e of audit) if (e.kind === 'tool_call' && e.error && RE_CANDADO.test(e.error)) candadoHits++;

// ── ledger/chain.jsonl (misiones) ──
const chain = readJsonl(join(ROOT, 'ledger', 'chain.jsonl'));
const missions = {}; // id -> {first, last, entries, model_calls, cost}
for (const m of chain) {
  if (!m.mission_id) continue;
  const r = (missions[m.mission_id] ||= { first: m.timestamp, last: m.timestamp, entries: 0, model_calls: 0, cost: 0 });
  r.entries++;
  r.model_calls = Math.max(r.model_calls, m.model_calls || 0);
  r.cost = Math.max(r.cost, m.total_cost || 0);
  if (m.timestamp < r.first) r.first = m.timestamp;
  if (m.timestamp > r.last) r.last = m.timestamp;
}
const missionsByWeek = {};
for (const [id, r] of Object.entries(missions)) {
  const w = isoWeek(r.last);
  (missionsByWeek[w] ||= []).push(id);
}

// ── salida ──
const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}×${v}`).join(', ') || '—';
const L = [];
L.push('# KPIs N0 — la sombra, medida desde el rastro');
L.push(`> Generado ${new Date().toISOString()} · fuente: audit.jsonl (${audit.length} entradas) + ledger/chain.jsonl (${chain.length} entradas, ${Object.keys(missions).length} misiones unicas)`);
L.push('');
L.push('## Tool calls por semana (audit.jsonl)');
L.push('');
L.push('| Semana | Calls | Exito | Fallo | %exito (proxy §4.3) | Sesiones | Top tools | Top errores |');
L.push('|---|---|---|---|---|---|---|---|');
for (const w of Object.keys(weeks).sort()) {
  const s = weeks[w];
  const pct = s.calls ? Math.round((s.ok / s.calls) * 100) : 0;
  L.push(`| ${w} | ${s.calls} | ${s.ok} | ${s.fail} | ${pct}% | ${s.sessions.size} | ${top(s.tools, 3)} | ${top(s.errs, 2)} |`);
}
L.push('');
L.push('## Misiones por semana (ledger)');
L.push('');
L.push('| Semana | Misiones | IDs |');
L.push('|---|---|---|');
for (const w of Object.keys(missionsByWeek).sort()) {
  const ids = missionsByWeek[w];
  L.push(`| ${w} | ${ids.length} | ${ids.slice(0, 3).join(', ')}${ids.length > 3 ? '…' : ''} |`);
}
L.push('');
L.push('## Estado de los KPIs del plan (§4.3)');
L.push('');
L.push(`- Interrupciones del candado: ${candadoHits} detectadas por patron sobre el campo error de tool_calls frenados${approvalKinds.length ? ` (+ kinds propios: ${approvalKinds.map(k => `${k}=${byKind[k]}`).join(', ')})` : '. NOTA: el audit aun NO emite un kind de aprobacion propio; viven como error de tool_call. Instrumentar kind dedicado en G1 para medir el voto "rastro" del candado con precision.'}`);
L.push(`- Kinds presentes en el audit: ${Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join(', ')}`);
L.push('- Tiempo a primera mision / retencion de anillo: sin datos hasta G3 (anillos).');
L.push('- Divergencia de replay: sin datos hasta que la suite corra con replay (G1/G2).');
console.log(L.join('\n'));
