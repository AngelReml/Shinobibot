/**
 * Pieza 4 — Council selectivo.
 *
 * `/sentinel forward <proposalId>` pasa una propuesta a un council de
 * 3 roles con un prompt distinto al de auditoría de repo:
 * "evalúa esta propuesta como mejora potencial a Shinobi".
 *
 *   - arquitecto       → ¿viable técnicamente?
 *   - security_auditor → ¿riesgos?
 *   - strategic_critic → ¿alinea con el posicionamiento de Shinobi?  (rol nuevo)
 *
 * El mediator combina los 3 stances → verdict APPROVE | REJECT |
 * RESEARCH_MORE. La decisión se anota en
 * docs/sentinel/decisions/<fecha>_<id>.md. NUNCA se implementa solo.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { SentinelProposal, CouncilDecision } from './types.js';

export type Stance = 'favorable' | 'cauto' | 'contrario';

export interface RoleVerdict {
  role: string;
  stance: Stance;
  note: string;
}

export interface CouncilRole {
  id: string;
  question: string;
  systemPrompt: string;
}

export const COUNCIL_ROLES: CouncilRole[] = [
  {
    id: 'arquitecto',
    question: '¿Es viable técnicamente integrar esto en Shinobi?',
    systemPrompt:
      'Eres arquitecto de software de Shinobi (agente autónomo Windows-native, TypeScript/Node). ' +
      'Evalúa si la propuesta es viable técnicamente: encaja con la arquitectura modular por bloques, ' +
      'no rompe invariantes del runtime, esfuerzo razonable. Responde JSON {stance, note}. ' +
      'stance ∈ favorable|cauto|contrario. note: 1-2 frases concretas.',
  },
  {
    id: 'security_auditor',
    question: '¿Introduce riesgos de seguridad?',
    systemPrompt:
      'Eres auditor de seguridad de Shinobi. Evalúa si la propuesta abre superficie de ataque, ' +
      'maneja secretos, ejecuta código no confiable, o viola las reglas (no matar procesos del ' +
      'sistema, no exfiltrar). Responde JSON {stance, note}. stance ∈ favorable|cauto|contrario.',
  },
  {
    id: 'strategic_critic',
    question: '¿Alinea con el posicionamiento de Shinobi?',
    systemPrompt:
      'Eres el crítico estratégico de Shinobi. El posicionamiento de Shinobi: agente Windows-native ' +
      'con auditabilidad y reproducibilidad superiores, no un clon de Hermes/OpenClaw. Evalúa si la ' +
      'propuesta refuerza ese posicionamiento o lo diluye (feature por moda, dependencia pesada, ' +
      'scope creep). Responde JSON {stance, note}. stance ∈ favorable|cauto|contrario.',
  },
];

export type CouncilLLM = (systemPrompt: string, userPrompt: string) => Promise<string>;

function buildUserPrompt(p: SentinelProposal): string {
  return [
    'Propuesta a evaluar:',
    `Título: ${p.title}`,
    `Descripción: ${p.description}`,
    `Área de Shinobi: ${p.shinobiArea}`,
    `Esfuerzo estimado: ${p.effort}`,
    `Riesgos señalados: ${p.risks.join('; ') || 'ninguno'}`,
    `Fuente: ${p.sourceLink}`,
  ].join('\n');
}

function parseStance(raw: string): RoleVerdict['stance'] {
  const s = raw.toLowerCase();
  if (/contrario|reject|no\b/.test(s)) return 'contrario';
  if (/cauto|caution|research|duda/.test(s)) return 'cauto';
  return 'favorable';
}

/** Ejecuta un rol del council. */
async function runRole(role: CouncilRole, p: SentinelProposal, llm: CouncilLLM): Promise<RoleVerdict> {
  try {
    const raw = await llm(role.systemPrompt, buildUserPrompt(p));
    let stance: Stance = 'cauto';
    let note = raw.slice(0, 240);
    try {
      const json = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '').trim());
      stance = parseStance(String(json.stance ?? ''));
      note = String(json.note ?? note).slice(0, 240);
    } catch {
      stance = parseStance(raw);
    }
    return { role: role.id, stance, note };
  } catch (e: any) {
    return { role: role.id, stance: 'cauto', note: `error: ${e?.message ?? e}` };
  }
}

/**
 * Mediator heurístico: combina los 3 stances.
 *   - algún 'contrario'                → REJECT
 *   - todos 'favorable'                → APPROVE
 *   - resto (mezcla con 'cauto')       → RESEARCH_MORE
 */
export function mediate(verdicts: RoleVerdict[]): { verdict: CouncilDecision['verdict']; rationale: string } {
  const contrarios = verdicts.filter((v) => v.stance === 'contrario');
  const favorables = verdicts.filter((v) => v.stance === 'favorable');
  if (contrarios.length > 0) {
    return {
      verdict: 'REJECT',
      rationale: `Rechazada: ${contrarios.map((v) => v.role).join(', ')} en contra. ` +
        contrarios.map((v) => `[${v.role}] ${v.note}`).join(' '),
    };
  }
  if (favorables.length === verdicts.length) {
    return {
      verdict: 'APPROVE',
      rationale: 'Aprobada: los 3 roles del council la respaldan. NO se implementa automáticamente — ' +
        'queda registrada para que el humano la firme.',
    };
  }
  return {
    verdict: 'RESEARCH_MORE',
    rationale: 'Sin consenso pleno: ' +
      verdicts.map((v) => `[${v.role}:${v.stance}] ${v.note}`).join(' ') +
      ' — requiere más investigación antes de decidir.',
  };
}

export interface ForwardOptions {
  /** Directorio docs/sentinel/decisions/. */
  decisionsDir: string;
  llm: CouncilLLM;
  nowFn?: () => Date;
}

/** Forward completo: 3 roles → mediator → escribe la decisión. */
export async function forwardToCouncil(
  proposal: SentinelProposal,
  opts: ForwardOptions,
): Promise<CouncilDecision> {
  const now = opts.nowFn ? opts.nowFn() : new Date();
  const verdicts = await Promise.all(COUNCIL_ROLES.map((r) => runRole(r, proposal, opts.llm)));
  const { verdict, rationale } = mediate(verdicts);

  const roleNotes: Record<string, string> = {};
  for (const v of verdicts) roleNotes[v.role] = `[${v.stance}] ${v.note}`;

  const decision: CouncilDecision = {
    proposalId: proposal.proposalId,
    verdict,
    rationale,
    roleNotes,
    decidedAt: now.toISOString(),
  };

  writeDecisionDoc(opts.decisionsDir, proposal, decision, now);
  return decision;
}

function writeDecisionDoc(
  dir: string,
  p: SentinelProposal,
  d: CouncilDecision,
  now: Date,
): string {
  mkdirSync(dir, { recursive: true });
  const date = now.toISOString().slice(0, 10);
  const path = join(dir, `${date}_${p.proposalId}.md`);
  const md = [
    `# Decisión del Council · ${p.proposalId}`,
    '',
    `- Fecha: ${d.decidedAt}`,
    `- Propuesta: **${p.title}**`,
    `- Veredicto: **${d.verdict}**`,
    '',
    '## Propuesta',
    `${p.description}`,
    '',
    `- Área Shinobi: ${p.shinobiArea}`,
    `- Esfuerzo: ${p.effort}`,
    `- Riesgos: ${p.risks.join('; ') || 'ninguno'}`,
    `- Fuente: ${p.sourceLink}`,
    '',
    '## Votos del council',
    ...Object.entries(d.roleNotes).map(([role, note]) => `- **${role}**: ${note}`),
    '',
    '## Veredicto del mediator',
    d.rationale,
    '',
    '---',
    '_Sentinel NO implementa propuestas automáticamente. Esta decisión queda',
    'registrada para que el humano la firme._',
    '',
  ].join('\n');
  writeFileSync(path, md, 'utf-8');
  return path;
}
