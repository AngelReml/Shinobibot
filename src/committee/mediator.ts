/**
 * Mediator — rol especial que resuelve disensos no consensuados.
 *
 * Cuando los roles devuelven `risk_level` divergentes y NO hay mayoría
 * clara (≥50% del peso total), el mediator entra y emite un veredicto
 * razonado considerando:
 *
 *   - Los pesos de los roles que disienten (vote_history.computeWeight)
 *   - La severidad propia de cada posición (high > medium > low)
 *   - Reglas de calibración: si un rol con peso ≥1.3 declara high y
 *     ningún rol contrario con peso ≥1.3 lo refuta, el final es high.
 *
 * Diseño limpio: el mediator es DETERMINISTA en su capa heurística
 * (sin LLM). Hay un mediator opt-in con LLM (`SHINOBI_MEDIATOR_LLM=1`)
 * que pide consejo a un modelo neutral cuando la heurística empata.
 *
 * Diferenciador: ningún rival tiene escalación con peso histórico.
 * Hermes y OpenClaw colapsan disensos a un promedio o al primer voto.
 */

import type { MemberReport, MemberError } from './Committee.js';
import { computeWeight } from './vote_history.js';

export interface WeightedVote {
  roleId: string;
  risk: 'low' | 'medium' | 'high';
  weight: number;
  /** rationale corto extraído de las weaknesses para audit trail. */
  rationale?: string;
}

export interface MediatorResult {
  finalRisk: 'low' | 'medium' | 'high';
  rationale: string;
  votingTallies: Record<'low' | 'medium' | 'high', number>;
  confidence: 'high' | 'medium' | 'low';
  invokedLLM: boolean;
}

const RISK_VALUES: Record<'low' | 'medium' | 'high', number> = { low: 1, medium: 2, high: 3 };
const VAL_TO_RISK: Record<number, 'low' | 'medium' | 'high'> = { 1: 'low', 2: 'medium', 3: 'high' };

export function votesFromMembers(
  members: (MemberReport | MemberError)[],
  weightsByRoleId: Map<string, number> = new Map(),
): WeightedVote[] {
  const votes: WeightedVote[] = [];
  for (const m of members) {
    if ('error' in m) continue;
    const w = weightsByRoleId.get(m.role) ?? 1.0;
    votes.push({
      roleId: m.role,
      risk: m.risk_level,
      weight: w,
      rationale: m.weaknesses[0]?.slice(0, 200),
    });
  }
  return votes;
}

/**
 * Mediador heurístico. Devuelve `MediatorResult.invokedLLM = false`
 * cuando la heurística llega a un veredicto claro. Si está empatado, el
 * caller puede llamar al LLM mediator si está habilitado.
 */
export function mediateHeuristic(votes: WeightedVote[]): MediatorResult {
  if (votes.length === 0) {
    return {
      finalRisk: 'medium',
      rationale: 'no votes — defaulting to medium',
      votingTallies: { low: 0, medium: 0, high: 0 },
      confidence: 'low',
      invokedLLM: false,
    };
  }

  const tallies: Record<'low' | 'medium' | 'high', number> = { low: 0, medium: 0, high: 0 };
  for (const v of votes) tallies[v.risk] += v.weight;
  const totalWeight = votes.reduce((s, v) => s + v.weight, 0);

  // Regla 1: cualquier rol con peso ≥1.3 declarando high y NO refutado
  // por otro de peso ≥1.3 declarando low → final = high.
  const highStrong = votes.filter(v => v.risk === 'high' && v.weight >= 1.3);
  const lowStrong = votes.filter(v => v.risk === 'low' && v.weight >= 1.3);
  if (highStrong.length > 0 && lowStrong.length === 0) {
    return {
      finalRisk: 'high',
      rationale: `strong vote(s) for high without strong refutation (high-weight: ${highStrong.map(h => h.roleId).join(', ')})`,
      votingTallies: tallies,
      confidence: 'high',
      invokedLLM: false,
    };
  }

  // Regla 2: mayoría ponderada >= 50% → ese tier gana.
  const sorted = (Object.entries(tallies) as Array<['low' | 'medium' | 'high', number]>)
    .sort((a, b) => b[1] - a[1]);
  const [topRisk, topWeight] = sorted[0];
  if (topWeight >= totalWeight / 2) {
    const conf = topWeight / totalWeight >= 0.75 ? 'high' : 'medium';
    return {
      finalRisk: topRisk,
      rationale: `weighted majority (${topRisk}: ${topWeight.toFixed(2)} / ${totalWeight.toFixed(2)})`,
      votingTallies: tallies,
      confidence: conf,
      invokedLLM: false,
    };
  }

  // Regla 3 (empate): tomamos la mediana ponderada del valor de risk.
  const weighted: number[] = [];
  for (const v of votes) {
    const val = RISK_VALUES[v.risk];
    const count = Math.max(1, Math.round(v.weight * 10));
    for (let i = 0; i < count; i++) weighted.push(val);
  }
  weighted.sort((a, b) => a - b);
  const medianVal = weighted[Math.floor(weighted.length / 2)];
  const medianRisk = VAL_TO_RISK[medianVal] ?? 'medium';
  return {
    finalRisk: medianRisk,
    rationale: `weighted median fallback (no majority): values=[${weighted.join(',')}]`,
    votingTallies: tallies,
    confidence: 'low',
    invokedLLM: false,
  };
}

export function isLLMMediatorEnabled(): boolean {
  return process.env.SHINOBI_MEDIATOR_LLM === '1';
}

export { computeWeight };
