/**
 * kagemusha/synth/render.ts — render a DawnReport to markdown + sinks (§10.3).
 *
 * The report is written to a file always; a Telegram sink is optional (off). The
 * sink interface is decoupled — the "OpenClaw that messages you at dawn" model.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DawnReport } from '../types.js';

export function renderMarkdown(r: DawnReport): string {
  const L: string[] = [];
  L.push(`# Informe del Amanecer — ${r.report_id}`);
  L.push('');
  L.push(`*Misión ${r.mission_id} · ${r.generated_at}*`);
  L.push(`Miré: ${r.looked_at.channels} canales · ${r.looked_at.transcripts} transcripts · ${r.looked_at.threads} hilos.`);
  L.push('');
  L.push('## Lo que vale');
  if (r.highlights.length === 0) L.push('_(nada superó el umbral de credibilidad — prefiero corto y verdadero)_');
  for (const h of r.highlights) {
    const conf = `${Math.round(h.confidence * 100)}%`;
    const src = h.provenance.map((p) => `${p.channel} t${p.trust_tier}${p.source_url ? ` ${p.source_url}` : ''}`).join('; ');
    L.push(`- **${h.text}**  _(confianza ${conf}; ${src})_`);
    if (h.contrast) L.push(`  - contraste: **${h.contrast.verdict}** → \`${h.contrast.codebase_unit ?? '—'}\` — ${h.contrast.rationale}`);
  }
  L.push('');
  L.push('## Qué construir');
  if (r.build_suggestions.length === 0) L.push('_(sin sugerencias fundamentadas esta vez)_');
  for (const b of r.build_suggestions) L.push(`- ${b.text}  _(base: ${b.basis})_`);
  L.push('');
  L.push('## Qué descarté y por qué');
  for (const d of r.discarded) L.push(`- ~~${d.text}~~ — ${d.reason}`);
  L.push('');
  L.push('## Huecos (no llegué)');
  for (const g of r.gaps) L.push(`- ${g}`);
  L.push('');
  L.push('## Sello de integridad');
  L.push(`- fabricaciones evitadas: **${r.integrity.fabrication_flags}**`);
  L.push(`- no-verificadas excluidas: **${r.integrity.unverified_excluded}**`);
  if (r.self_voice) {
    const v = r.self_voice;
    L.push('');
    L.push('## Segunda voz — cómo estoy por dentro (Kagami)');
    L.push(`- código: ${v.code_health.cracks_critical} grietas críticas / ${v.code_health.cracks_total} totales · tendencia **${v.code_health.trend}**`);
    L.push(`- frontera: ${v.frontier_summary.reliable} fiables · ${v.frontier_summary.shaky} dudosas · ${v.frontier_summary.beyond} fuera de alcance`);
    if (v.learning_progress) L.push(`- aprendiendo ${v.learning_progress.skill}: nivel ${v.learning_progress.level}${v.learning_progress.mastery ? ' (dominado)' : ' (en progreso)'}`);
    L.push(`- calibración: brier ${v.calibration.brier_score.toFixed(3)} · sesgo **${v.calibration.bias}**`);
    if (v.frontier_crossed_today) L.push(`- frontera nueva que crucé hoy: ${v.frontier_crossed_today}`);
  }
  L.push('');
  L.push('_No te traigo nada que no haya verificado. Un comentario no es un hecho._');
  return L.join('\n') + '\n';
}

export interface ReportSink { deliver(report: DawnReport, rendered: string): Promise<void>; }

/** File sink — always writes reports/<mission_id>.md. */
export class FileSink implements ReportSink {
  constructor(private dir = 'reports') {}
  async deliver(report: DawnReport, rendered: string): Promise<void> {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, `${report.mission_id}.md`), rendered, 'utf-8');
  }
}
