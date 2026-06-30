/**
 * E5 — generación del briefing al operador.
 *
 * Formato:
 *   1. Qué emerge   — hipótesis SOLID (signal fuerte)
 *   2. Qué propone  — hipótesis PLAUSIBLE esperando aprobación
 *   3. Apuestas     — bets pendientes y resueltos con calibración
 *
 * El operador lee el briefing y decide qué apuestas registrar.
 * Las hipótesis aprobadas pasan a E6.
 */

import type { E5BriefingEntry, E5Hypothesis } from './e5_types.js';
import type { E5Bet } from './e5_types.js';

export interface BriefingInput {
  hypotheses: E5Hypothesis[];
  pendingBets: E5Bet[];
  resolvedBets: E5Bet[];
  calibrationScore: number;
}

function dimensionLabel(d: string): string {
  const map: Record<string, string> = {
    'pass@1': 'Tasa de éxito (pass@1)',
    pass_k: 'Consistencia (pass^k)',
    safety: 'Seguridad (0 acciones irreversibles)',
    verificability: 'Verificabilidad (provenance)',
    self_correction: 'Auto-corrección',
    latency: 'Latencia',
    cost: 'Coste',
    accessibility: 'Accesibilidad',
  };
  return map[d] ?? d;
}

export function renderBriefing(input: BriefingInput): string {
  const lines: string[] = [];
  const now = new Date().toISOString().slice(0, 10);

  lines.push(`# Briefing E5 — Señal y Apuestas · ${now}`);
  lines.push('');

  // ── SOLID (señal fuerte) ───────────────────────────────────────────
  const solid = input.hypotheses.filter((h) => h.credibility === 'SOLID');
  lines.push('## Qué emerge (señal SOLID)');
  if (solid.length === 0) {
    lines.push('_Sin señal fuerte esta semana._');
  } else {
    for (const h of solid) {
      lines.push(`### ${dimensionLabel(h.dimension)}`);
      lines.push(`**${h.title}**`);
      lines.push(h.description);
      lines.push(`_Score: ${h.credibilityScore.toFixed(2)} · ${h.supportingClaims.length} claim(s)_`);
      if (!h.betId) lines.push(`→ \`/sentinel bet ${h.hypothesisId}\` para registrar la apuesta.`);
      else lines.push(`→ Apuesta registrada: \`${h.betId}\``);
      lines.push('');
    }
  }
  lines.push('');

  // ── PLAUSIBLE (señal débil, esperando aprobación) ──────────────────
  const plausible = input.hypotheses.filter((h) => h.credibility === 'PLAUSIBLE');
  lines.push('## Qué propone (señal PLAUSIBLE — a tu criterio)');
  if (plausible.length === 0) {
    lines.push('_Sin hipótesis plausibles esta semana._');
  } else {
    for (const h of plausible) {
      lines.push(`- **[${dimensionLabel(h.dimension)}]** ${h.title}`);
      lines.push(`  _Score: ${h.credibilityScore.toFixed(2)} · ${h.supportingClaims.length} claim(s)_`);
      if (!h.betId) lines.push(`  → \`/sentinel bet ${h.hypothesisId}\``);
    }
  }
  lines.push('');

  // ── APUESTAS PENDIENTES ────────────────────────────────────────────
  lines.push('## Apuestas pendientes');
  if (input.pendingBets.length === 0) {
    lines.push('_Sin apuestas abiertas._');
  } else {
    lines.push('| Bet | Dimensión | Credibilidad inicial | Registrada |');
    lines.push('|---|---|---|---|');
    for (const b of input.pendingBets) {
      lines.push(`| \`${b.betId}\` | ${dimensionLabel(b.dimension)} | ${b.credibilityAtBet} | ${b.registeredAt.slice(0, 10)} |`);
    }
    lines.push('');
    lines.push('Resolver: `/sentinel bet resolve <betId> win|miss|partial`');
  }
  lines.push('');

  // ── CALIBRACIÓN ────────────────────────────────────────────────────
  lines.push('## Calibración acumulada');
  const done = input.resolvedBets;
  if (done.length === 0) {
    lines.push('_Sin apuestas resueltas aún._');
  } else {
    const wins = done.filter((b) => b.outcome === 'WIN').length;
    const misses = done.filter((b) => b.outcome === 'MISS').length;
    const partials = done.filter((b) => b.outcome === 'PARTIAL').length;
    const score = input.calibrationScore;
    const verdict = score >= 0 ? '✅ buen criterio' : '⚠️ se pierden tendencias';
    lines.push(`- Total resueltas: ${done.length} (${wins} WIN, ${partials} PARTIAL, ${misses} MISS)`);
    lines.push(`- Puntuación asimétrica: **${score.toFixed(1)}** — ${verdict}`);
    lines.push('');
    lines.push('_Recuerda: MISS penaliza el doble (−2). Perderse una tendencia real cuesta más que perseguir una falsa._');
  }

  return lines.join('\n');
}

/** Construye las entradas del briefing desde hipótesis y bets. */
export function buildBriefingEntries(
  hypotheses: E5Hypothesis[],
  bets: E5Bet[],
): E5BriefingEntry[] {
  const betByHyp = new Map(bets.map((b) => [b.hypothesisId, b]));
  return hypotheses.map((h): E5BriefingEntry => ({
    dimension: h.dimension,
    hypothesis: h,
    pendingBet: betByHyp.has(h.hypothesisId) && betByHyp.get(h.hypothesisId)!.outcome === null,
    evidence: h.supportingClaims.slice(0, 3),
  }));
}
