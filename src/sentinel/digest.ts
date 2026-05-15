/**
 * Pieza 5 — Boletín de baja fricción.
 *
 * `/sentinel digest [--week|--month]` — resumen breve en markdown:
 * items archivados, fuentes activas, decisiones del council. Una
 * pantalla, no un informe. Honestidad explícita: si la señal es baja,
 * lo dice.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { listArchived } from './query.js';

export type DigestWindow = 'week' | 'month';

export interface DigestData {
  window: DigestWindow;
  sinceDate: string;
  archivedCount: number;
  activeSources: number;
  decisions: Array<{ id: string; verdict: string; date: string }>;
  lowSignal: boolean;
}

function daysAgo(n: number, now: Date): string {
  return new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Recolecta los datos del digest. */
export function collectDigest(opts: {
  rawDir: string;
  decisionsDir: string;
  activeSources: number;
  window: DigestWindow;
  nowFn?: () => Date;
}): DigestData {
  const now = opts.nowFn ? opts.nowFn() : new Date();
  const sinceDate = daysAgo(opts.window === 'week' ? 7 : 30, now);

  const archived = listArchived(opts.rawDir, sinceDate);

  const decisions: DigestData['decisions'] = [];
  if (existsSync(opts.decisionsDir)) {
    for (const file of readdirSync(opts.decisionsDir).sort()) {
      if (!file.endsWith('.md')) continue;
      const date = file.slice(0, 10);
      if (date < sinceDate) continue;
      const text = readFileSync(join(opts.decisionsDir, file), 'utf-8');
      const verdict = text.match(/Veredicto:\s*\*\*(\w+)\*\*/)?.[1] ?? '?';
      decisions.push({ id: file.replace(/\.md$/, ''), verdict, date });
    }
  }

  return {
    window: opts.window,
    sinceDate,
    archivedCount: archived.length,
    activeSources: opts.activeSources,
    decisions,
    lowSignal: archived.length === 0 && decisions.length === 0,
  };
}

/** Renderiza el digest a markdown — una pantalla. */
export function renderDigest(d: DigestData): string {
  const lines: string[] = [];
  const win = d.window === 'week' ? 'última semana' : 'último mes';
  lines.push(`# Sentinel digest · ${win}`);
  lines.push(`_desde ${d.sinceDate}_`);
  lines.push('');
  lines.push(`- Fuentes activas: ${d.activeSources}`);
  lines.push(`- Items archivados: ${d.archivedCount}`);
  lines.push(`- Decisiones del council: ${d.decisions.length}`);
  if (d.decisions.length > 0) {
    for (const dec of d.decisions) {
      lines.push(`  - ${dec.date} · ${dec.id} → **${dec.verdict}**`);
    }
  }
  lines.push('');

  if (d.activeSources === 0) {
    lines.push('⚠ No hay fuentes configuradas. Edita `config/sentinel/sources.yaml`.');
  } else if (d.lowSignal) {
    lines.push('Señal baja: ni items nuevos ni decisiones en esta ventana.');
    lines.push('Si esto se repite, revisa si las fuentes siguen activas o añade más.');
  } else {
    const pending = d.archivedCount - d.decisions.length;
    if (pending > 0) {
      lines.push(`Hay ~${pending} items sin pasar por el council. Usa \`/sentinel ask\` y ` +
        '`/sentinel forward` para procesarlos.');
    }
  }
  return lines.join('\n');
}

/**
 * Detecta "3 digests seguidos sin propuestas" comparando con un
 * histórico de flags lowSignal. Devuelve true si hay que sugerir
 * revisar fuentes.
 */
export function shouldSuggestSourceReview(recentLowSignalFlags: boolean[]): boolean {
  const last3 = recentLowSignalFlags.slice(-3);
  return last3.length === 3 && last3.every(Boolean);
}
