/**
 * MetricsRegistry — agregador in-process de counters, gauges e
 * histogramas. Sprint 2.4.
 *
 * Diseño minimalista, sin dependencias externas: lo justo para que
 * `/admin/metrics/prom` exporte algo legible por Prometheus y
 * `/admin/dashboard` muestre números en tiempo real.
 *
 * Tipos soportados:
 *   - Counter:    monotónico no-decreciente, `inc(value=1)`.
 *   - Gauge:      valor arbitrario, `set(value)` o `inc/dec`.
 *   - Histogram:  buckets fijos por nombre, `observe(value)`.
 *
 * Etiquetas (labels): inline en el nombre de la métrica con sintaxis
 * `metric_name{label1="v1",label2="v2"}` al exportar. Internamente,
 * cada combinación label-set es una métrica distinta indexada por una
 * clave canónica.
 */

export interface HistogramOpts {
  buckets: number[];
}

type LabelSet = Record<string, string>;

interface CounterState {
  type: 'counter';
  help?: string;
  values: Map<string, { labels: LabelSet; value: number }>;
}
interface GaugeState {
  type: 'gauge';
  help?: string;
  values: Map<string, { labels: LabelSet; value: number }>;
}
interface HistogramState {
  type: 'histogram';
  help?: string;
  buckets: number[];
  // Por label-set: counts de buckets + sum + count.
  series: Map<string, { labels: LabelSet; bucketCounts: number[]; sum: number; count: number }>;
}

type MetricState = CounterState | GaugeState | HistogramState;

function labelKey(labels: LabelSet | undefined): string {
  if (!labels || Object.keys(labels).length === 0) return '';
  const keys = Object.keys(labels).sort();
  return keys.map(k => `${k}=${labels[k]}`).join(',');
}

export class MetricsRegistry {
  private readonly metrics = new Map<string, MetricState>();

  describeCounter(name: string, help?: string): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, { type: 'counter', help, values: new Map() });
    }
  }
  describeGauge(name: string, help?: string): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, { type: 'gauge', help, values: new Map() });
    }
  }
  describeHistogram(name: string, opts: HistogramOpts, help?: string): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, {
        type: 'histogram',
        help,
        buckets: [...opts.buckets].sort((a, b) => a - b),
        series: new Map(),
      });
    }
  }

  /** Atomic increment. Si no estaba descrito, lo crea como counter. */
  counterInc(name: string, value: number = 1, labels?: LabelSet): void {
    let m = this.metrics.get(name);
    if (!m) { this.describeCounter(name); m = this.metrics.get(name)!; }
    if (m.type !== 'counter') throw new Error(`metric ${name} no es counter`);
    if (value < 0) throw new Error(`counter ${name} no puede decrecer`);
    const k = labelKey(labels);
    const cur = m.values.get(k) ?? { labels: labels ?? {}, value: 0 };
    cur.value += value;
    m.values.set(k, cur);
  }

  gaugeSet(name: string, value: number, labels?: LabelSet): void {
    let m = this.metrics.get(name);
    if (!m) { this.describeGauge(name); m = this.metrics.get(name)!; }
    if (m.type !== 'gauge') throw new Error(`metric ${name} no es gauge`);
    const k = labelKey(labels);
    m.values.set(k, { labels: labels ?? {}, value });
  }

  gaugeInc(name: string, delta: number = 1, labels?: LabelSet): void {
    let m = this.metrics.get(name);
    if (!m) { this.describeGauge(name); m = this.metrics.get(name)!; }
    if (m.type !== 'gauge') throw new Error(`metric ${name} no es gauge`);
    const k = labelKey(labels);
    const cur = m.values.get(k) ?? { labels: labels ?? {}, value: 0 };
    cur.value += delta;
    m.values.set(k, cur);
  }

  histogramObserve(name: string, value: number, labels?: LabelSet): void {
    const m = this.metrics.get(name);
    if (!m || m.type !== 'histogram') {
      throw new Error(`metric ${name} no es histogram (describeHistogram() primero)`);
    }
    const k = labelKey(labels);
    let series = m.series.get(k);
    if (!series) {
      series = { labels: labels ?? {}, bucketCounts: new Array(m.buckets.length + 1).fill(0), sum: 0, count: 0 };
      m.series.set(k, series);
    }
    series.sum += value;
    series.count += 1;
    // Buckets son "<=N" cumulativos. Encuentra el menor bucket que cumple.
    let placed = false;
    for (let i = 0; i < m.buckets.length; i++) {
      if (value <= m.buckets[i]) {
        for (let j = i; j < m.buckets.length; j++) series.bucketCounts[j] += 1;
        placed = true;
        break;
      }
    }
    // +Inf bucket (último índice) siempre incrementa.
    series.bucketCounts[m.buckets.length] += 1;
    void placed;
  }

  /** Snapshot completo en formato JSON. */
  snapshotJson(): any {
    const out: any = {};
    for (const [name, m] of this.metrics) {
      if (m.type === 'counter') {
        out[name] = { type: 'counter', help: m.help, values: [...m.values.values()] };
      } else if (m.type === 'gauge') {
        out[name] = { type: 'gauge', help: m.help, values: [...m.values.values()] };
      } else {
        out[name] = {
          type: 'histogram',
          help: m.help,
          buckets: m.buckets,
          series: [...m.series.values()].map(s => ({
            labels: s.labels,
            bucketCounts: s.bucketCounts,
            sum: s.sum,
            count: s.count,
          })),
        };
      }
    }
    return out;
  }

  /** Exporta en formato Prometheus exposition (texto). */
  exportPrometheus(): string {
    const lines: string[] = [];
    for (const [name, m] of this.metrics) {
      if (m.help) lines.push(`# HELP ${name} ${m.help}`);
      lines.push(`# TYPE ${name} ${m.type}`);
      if (m.type === 'counter' || m.type === 'gauge') {
        for (const v of m.values.values()) {
          lines.push(`${name}${formatLabels(v.labels)} ${v.value}`);
        }
      } else {
        for (const s of m.series.values()) {
          for (let i = 0; i < m.buckets.length; i++) {
            const le = String(m.buckets[i]);
            lines.push(`${name}_bucket${formatLabels({ ...s.labels, le })} ${s.bucketCounts[i]}`);
          }
          lines.push(`${name}_bucket${formatLabels({ ...s.labels, le: '+Inf' })} ${s.bucketCounts[m.buckets.length]}`);
          lines.push(`${name}_sum${formatLabels(s.labels)} ${s.sum}`);
          lines.push(`${name}_count${formatLabels(s.labels)} ${s.count}`);
        }
      }
    }
    return lines.join('\n') + (lines.length > 0 ? '\n' : '');
  }

  /** Para tests: borra todo. */
  reset(): void {
    this.metrics.clear();
  }

  listMetricNames(): string[] {
    return [...this.metrics.keys()].sort();
  }
}

function formatLabels(labels: LabelSet): string {
  const keys = Object.keys(labels);
  if (keys.length === 0) return '';
  const parts = keys.sort().map(k => `${k}="${escapeLabelValue(labels[k])}"`);
  return `{${parts.join(',')}}`;
}

function escapeLabelValue(s: string): string {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

let _global: MetricsRegistry | null = null;
export function metrics(): MetricsRegistry {
  if (!_global) _global = new MetricsRegistry();
  return _global;
}

export function _resetMetrics(): void {
  _global = null;
}
