/**
 * Vote History — track record por rol del Committee evolutivo.
 *
 * Cada vez que el committee corre y se sintetiza un verdict, registramos
 * si cada rol estuvo "alineado" con el consenso final. Tras N
 * votaciones, podemos calcular un PESO para cada rol que se usa al
 * decidir la fuerza relativa de su voto en futuros consensus.
 *
 * Política de peso:
 *   - Default: 1.0 para todos los roles.
 *   - Si un rol estuvo alineado >70% de las veces → peso 1.0 + 0.5 × ratio = hasta 1.5
 *   - Si un rol disintió >60% de las veces (consistentemente equivocado vs consenso) → peso 0.5
 *   - Si un rol estuvo en dissents que LUEGO se resolvieron a su favor (su risk_level fue el aceptado) → peso sube hasta 2.0
 *
 * Persistencia: archivo `audit/committee_history.jsonl` append-only.
 * Lectura agregada al cargar el módulo (lazy, no bloquea start).
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

export interface VoteRecord {
  /** Timestamp ISO. */
  ts: string;
  /** Identificador de la sesión/review. */
  reviewId: string;
  /** Rol que votó. */
  roleId: string;
  /** risk_level que ese rol asignó. */
  roleRisk: 'low' | 'medium' | 'high';
  /** risk_level final del committee. */
  finalRisk: 'low' | 'medium' | 'high';
  /** True si la posición del rol coincidió con el consenso final. */
  aligned: boolean;
}

export interface RoleStats {
  roleId: string;
  total: number;
  aligned: number;
  /** Ratio aligned/total. 0.5 baseline si total = 0. */
  alignmentRatio: number;
  /** Peso final (0.5–2.0) para este rol. */
  weight: number;
}

const DEFAULT_PATH = './audit/committee_history.jsonl';

function resolvePath(): string {
  return process.env.SHINOBI_COMMITTEE_HISTORY_PATH || DEFAULT_PATH;
}

export class VoteHistory {
  private records: VoteRecord[] = [];
  private readonly path: string;

  constructor(path?: string) {
    this.path = path ?? resolvePath();
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (!existsSync(this.path)) return;
      const text = readFileSync(this.path, 'utf-8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line);
          if (r && typeof r === 'object' && r.roleId && r.finalRisk) {
            this.records.push(r as VoteRecord);
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* swallow */ }
  }

  appendRecord(rec: Omit<VoteRecord, 'ts'> & { ts?: string }): VoteRecord {
    const full: VoteRecord = { ts: new Date().toISOString(), ...rec };
    this.records.push(full);
    try {
      const dir = dirname(this.path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(this.path, JSON.stringify(full) + '\n', 'utf-8');
    } catch { /* best-effort */ }
    return full;
  }

  /** Stats agregadas por rol con peso 0.5–2.0. */
  statsFor(roleId: string): RoleStats {
    const mine = this.records.filter(r => r.roleId === roleId);
    const total = mine.length;
    const aligned = mine.filter(r => r.aligned).length;
    const ratio = total > 0 ? aligned / total : 0.5;
    return {
      roleId,
      total,
      aligned,
      alignmentRatio: ratio,
      weight: computeWeight(total, ratio),
    };
  }

  allStats(): RoleStats[] {
    const ids = new Set(this.records.map(r => r.roleId));
    return [...ids].map(id => this.statsFor(id));
  }

  /** Para tests: borra memoria sin tocar el archivo. */
  reset(): void {
    this.records = [];
  }

  /** Snapshot de records (immutable). */
  snapshot(): VoteRecord[] {
    return [...this.records];
  }
}

/**
 * Curva de peso por alignment ratio. Pure function, exportada para
 * tests directos.
 *
 *   total = 0       → 1.0 (sin historia, neutral)
 *   ratio >= 0.7    → 1.0 + 0.5 × (ratio - 0.7) / 0.3   (hasta 1.5)
 *   ratio <= 0.4    → 0.5 + 0.5 × ratio / 0.4           (hasta 1.0)
 *   else (0.4..0.7) → 1.0 (zona neutral)
 *
 * Para empujar hasta 2.0 (cuando un rol fue minoritario pero acertó), el
 * caller anota manualmente `bonusFor(roleId)` antes de calcular peso —
 * eso queda fuera de esta función pura.
 */
export function computeWeight(total: number, alignmentRatio: number): number {
  if (total === 0) return 1.0;
  if (alignmentRatio >= 0.7) {
    return Math.min(1.5, 1.0 + 0.5 * (alignmentRatio - 0.7) / 0.3);
  }
  if (alignmentRatio <= 0.4) {
    return Math.max(0.5, 0.5 + 0.5 * alignmentRatio / 0.4);
  }
  return 1.0;
}
