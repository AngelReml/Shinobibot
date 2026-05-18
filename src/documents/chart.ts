// src/documents/chart.ts
//
// Renderizador de gráficos a SVG plano — CERO dependencia nueva.
//
// Genera ficheros `.svg` que cualquier navegador abre/renderiza sin más.
// Soporta bar, line, scatter y pie. El SVG se construye por templating de
// strings: no hay librería de charting, en línea con la restricción del
// encargo ("sin librería ajena nueva").
//
// Honestidad de ejes (la regla del prompt madre de DataAgent): el eje de
// valores de un bar chart arranca en 0 (o en el mínimo si hay negativos),
// nunca se trunca para exagerar diferencias.

import * as fs from 'fs';
import * as path from 'path';

export type ChartType = 'bar' | 'line' | 'scatter' | 'pie';

export interface ChartDatum {
  /** Etiqueta de la categoría/punto. */
  label: string;
  /** Valor (eje Y para bar/line, magnitud para pie, Y para scatter). */
  value: number;
  /** Coordenada X numérica — solo para scatter. */
  x?: number;
}

export interface ChartSpec {
  type: ChartType;
  title: string;
  xLabel?: string;
  yLabel?: string;
  data: ChartDatum[];
}

export interface ChartResult {
  path: string;
  bytes: number;
  type: ChartType;
}

const W = 820;
const H = 520;
const PAD = { top: 60, right: 40, bottom: 90, left: 80 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Valida el spec. Lanza si no se puede renderizar honestamente. */
export function validateChartSpec(spec: ChartSpec): void {
  if (!spec || typeof spec !== 'object') throw new Error('ChartSpec ausente.');
  if (!(['bar', 'line', 'scatter', 'pie'] as const).includes(spec.type)) {
    throw new Error(`ChartSpec.type inválido: ${spec.type}`);
  }
  if (!spec.title || !spec.title.trim()) throw new Error('ChartSpec.title requerido.');
  if (!Array.isArray(spec.data) || spec.data.length === 0) throw new Error('ChartSpec.data vacío.');
  for (const d of spec.data) {
    if (typeof d.value !== 'number' || !Number.isFinite(d.value)) {
      throw new Error(`ChartSpec: valor no numérico en "${d.label}".`);
    }
    if (spec.type === 'scatter' && (typeof d.x !== 'number' || !Number.isFinite(d.x))) {
      throw new Error(`ChartSpec scatter: punto "${d.label}" sin coordenada x numérica.`);
    }
    if (spec.type === 'pie' && d.value < 0) {
      throw new Error(`ChartSpec pie: valor negativo en "${d.label}" (no representable).`);
    }
  }
}

function svgHeader(spec: ChartSpec): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Arial, sans-serif">\n` +
    `<rect width="${W}" height="${H}" fill="#ffffff"/>\n` +
    `<text x="${W / 2}" y="32" text-anchor="middle" font-size="20" font-weight="700" fill="#111">${esc(spec.title)}</text>\n`
  );
}

/** "Nice" tick step para un rango dado. */
function niceStep(range: number, target = 5): number {
  if (range <= 0) return 1;
  const raw = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1;
  return step * mag;
}

function axes(spec: ChartSpec, yMin: number, yMax: number): string {
  const x0 = PAD.left, y0 = PAD.top, x1 = PAD.left + PLOT_W, y1 = PAD.top + PLOT_H;
  let s = `<line x1="${x0}" y1="${y1}" x2="${x1}" y2="${y1}" stroke="#444" stroke-width="1.5"/>\n`;
  s += `<line x1="${x0}" y1="${y0}" x2="${x0}" y2="${y1}" stroke="#444" stroke-width="1.5"/>\n`;
  const step = niceStep(yMax - yMin);
  for (let v = Math.ceil(yMin / step) * step; v <= yMax + 1e-9; v += step) {
    const y = y1 - ((v - yMin) / (yMax - yMin || 1)) * PLOT_H;
    s += `<line x1="${x0}" y1="${y.toFixed(1)}" x2="${x1}" y2="${y.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>\n`;
    s += `<text x="${x0 - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#555">${(+v.toFixed(4))}</text>\n`;
  }
  if (spec.yLabel) {
    s += `<text x="18" y="${y0 + PLOT_H / 2}" text-anchor="middle" font-size="12" fill="#333" transform="rotate(-90 18 ${y0 + PLOT_H / 2})">${esc(spec.yLabel)}</text>\n`;
  }
  if (spec.xLabel) {
    s += `<text x="${x0 + PLOT_W / 2}" y="${H - 18}" text-anchor="middle" font-size="12" fill="#333">${esc(spec.xLabel)}</text>\n`;
  }
  return s;
}

function renderBar(spec: ChartSpec): string {
  const vals = spec.data.map(d => d.value);
  // Honestidad de eje: arranca en 0 (o en el mínimo si hay negativos).
  const yMin = Math.min(0, ...vals);
  const yMax = Math.max(0, ...vals);
  const span = yMax - yMin || 1;
  const y1 = PAD.top + PLOT_H;
  const n = spec.data.length;
  const slot = PLOT_W / n;
  const bw = slot * 0.62;
  let s = svgHeader(spec) + axes(spec, yMin, yMax);
  const zeroY = y1 - ((0 - yMin) / span) * PLOT_H;
  spec.data.forEach((d, i) => {
    const cx = PAD.left + slot * i + slot / 2;
    const vY = y1 - ((d.value - yMin) / span) * PLOT_H;
    const top = Math.min(vY, zeroY);
    const h = Math.abs(vY - zeroY);
    s += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${PALETTE[i % PALETTE.length]}"/>\n`;
    s += `<text x="${cx.toFixed(1)}" y="${(top - 6).toFixed(1)}" text-anchor="middle" font-size="11" fill="#222">${esc(String(d.value))}</text>\n`;
    s += `<text x="${cx.toFixed(1)}" y="${(y1 + 18).toFixed(1)}" text-anchor="middle" font-size="11" fill="#444">${esc(d.label)}</text>\n`;
  });
  return s + '</svg>\n';
}

function renderLine(spec: ChartSpec): string {
  const vals = spec.data.map(d => d.value);
  const yMin = Math.min(0, ...vals);
  const yMax = Math.max(...vals);
  const span = yMax - yMin || 1;
  const y1 = PAD.top + PLOT_H;
  const n = spec.data.length;
  let s = svgHeader(spec) + axes(spec, yMin, yMax);
  const pts = spec.data.map((d, i) => {
    const x = PAD.left + (n === 1 ? PLOT_W / 2 : (PLOT_W / (n - 1)) * i);
    const y = y1 - ((d.value - yMin) / span) * PLOT_H;
    return { x, y, d };
  });
  s += `<polyline fill="none" stroke="${PALETTE[0]}" stroke-width="2.5" points="${pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}"/>\n`;
  for (const p of pts) {
    s += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${PALETTE[0]}"/>\n`;
    s += `<text x="${p.x.toFixed(1)}" y="${(p.y - 10).toFixed(1)}" text-anchor="middle" font-size="10" fill="#222">${esc(String(p.d.value))}</text>\n`;
    s += `<text x="${p.x.toFixed(1)}" y="${(y1 + 18).toFixed(1)}" text-anchor="middle" font-size="11" fill="#444">${esc(p.d.label)}</text>\n`;
  }
  return s + '</svg>\n';
}

function renderScatter(spec: ChartSpec): string {
  const xs = spec.data.map(d => d.x as number);
  const ys = spec.data.map(d => d.value);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(0, ...ys), yMax = Math.max(...ys);
  const xSpan = xMax - xMin || 1, ySpan = yMax - yMin || 1;
  const y1 = PAD.top + PLOT_H;
  let s = svgHeader(spec) + axes(spec, yMin, yMax);
  for (let i = 0; i < spec.data.length; i++) {
    const d = spec.data[i];
    const x = PAD.left + ((d.x as number - xMin) / xSpan) * PLOT_W;
    const y = y1 - ((d.value - yMin) / ySpan) * PLOT_H;
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${PALETTE[i % PALETTE.length]}" fill-opacity="0.8"/>\n`;
  }
  return s + '</svg>\n';
}

function renderPie(spec: ChartSpec): string {
  const total = spec.data.reduce((a, d) => a + d.value, 0);
  if (total <= 0) throw new Error('ChartSpec pie: la suma de valores debe ser > 0.');
  const cx = PAD.left + PLOT_W / 2 - 90, cy = PAD.top + PLOT_H / 2, r = Math.min(PLOT_H, PLOT_W) / 2.4;
  let s = svgHeader(spec);
  let angle = -Math.PI / 2;
  spec.data.forEach((d, i) => {
    const frac = d.value / total;
    const next = angle + frac * 2 * Math.PI;
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(next), y2 = cy + r * Math.sin(next);
    const large = frac > 0.5 ? 1 : 0;
    s += `<path d="M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${PALETTE[i % PALETTE.length]}"/>\n`;
    const mid = (angle + next) / 2;
    const lx = cx + (r + 24) * Math.cos(mid), ly = cy + (r + 24) * Math.sin(mid);
    s += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="11" fill="#333">${esc(d.label)} (${(frac * 100).toFixed(1)}%)</text>\n`;
    angle = next;
  });
  // Leyenda.
  spec.data.forEach((d, i) => {
    const ly = PAD.top + 10 + i * 20;
    const lx = W - PAD.right - 150;
    s += `<rect x="${lx}" y="${ly - 10}" width="12" height="12" fill="${PALETTE[i % PALETTE.length]}"/>\n`;
    s += `<text x="${lx + 18}" y="${ly}" font-size="11" fill="#333">${esc(d.label)}</text>\n`;
  });
  return s + '</svg>\n';
}

/** Renderiza el spec a markup SVG. */
export function renderChartSvg(spec: ChartSpec): string {
  validateChartSpec(spec);
  switch (spec.type) {
    case 'bar': return renderBar(spec);
    case 'line': return renderLine(spec);
    case 'scatter': return renderScatter(spec);
    case 'pie': return renderPie(spec);
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'chart';
}

/** Renderiza y escribe el gráfico a un fichero .svg. Devuelve la ruta. */
export function writeChart(spec: ChartSpec, outputDir?: string): ChartResult {
  const svg = renderChartSvg(spec);
  const dir = outputDir || path.join(process.cwd(), 'artifacts', 'charts');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug(spec.title)}-${Date.now().toString(36)}.svg`);
  fs.writeFileSync(file, svg, 'utf-8');
  return { path: file, bytes: Buffer.byteLength(svg), type: spec.type };
}
