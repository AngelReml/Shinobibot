// Habilidad B.2 — Comité de validación.
// Tres roles configurables corren en paralelo sobre un report.json (típicamente
// el último /self) y cada uno devuelve un MemberReport JSON. Una síntesis final
// detecta consenso y disensos sin promediar.

import { tryParseJSON } from '../reader/schemas.js';
import type { LLMClient } from '../reader/SubAgent.js';

export interface MemberReport {
  role: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  risk_level: 'low' | 'medium' | 'high';
}

export interface MemberError {
  role: string;
  error: string;
}

export interface Consensus {
  topic: string;
  agreeing_roles: string[];
}

export interface Dissent {
  topic: string;
  positions: { role: string; position: string }[];
}

export interface CommitteeSynthesis {
  consensus: Consensus[];
  dissents: Dissent[];
  combined_recommendations: string[];
  overall_risk: 'low' | 'medium' | 'high';
}

export interface CommitteeRole {
  role: string;
  model: string;          // logical model name routed by llm_adapter
  systemPrompt: string;
}

export const DEFAULT_ROLES: CommitteeRole[] = [
  {
    role: 'architect',
    model: 'claude-opus-4-7',
    systemPrompt:
      'You are a senior software architect. Review the repo report below and assess: structural soundness, module boundaries, coupling, and architectural risks. Focus on whether the architecture makes long-term sense.',
  },
  {
    role: 'security_auditor',
    model: 'claude-haiku-4-5',
    systemPrompt:
      'You are a security auditor. Review the repo report below and assess: attack surface, secret handling, command execution, file system access, dependency risk. Focus only on security concerns.',
  },
  {
    role: 'design_critic',
    model: 'claude-haiku-4-5',
    systemPrompt:
      'You are a senior design critic. Review the repo report below and assess: API ergonomics, naming, scope creep, hidden complexity, and product coherence. Be blunt about flaws.',
  },
];

const MEMBER_OUTPUT_RULES = `
Return ONE JSON object with this exact shape (no prose, no fence):
{
  "role": string,
  "strengths": string[],          // max 6, each <=200 chars
  "weaknesses": string[],         // max 6, each <=200 chars
  "recommendations": string[],    // max 6, each <=200 chars, concrete actions
  "risk_level": "low" | "medium" | "high"
}
- Be specific. Reference module names, file paths, or risks from the input.
- Do NOT invent files or modules not mentioned in the input.
- "recommendations" must be actionable, not aspirational.
`;

function validateMemberReport(raw: unknown): { ok: true; value: MemberReport } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not an object' };
  const r = raw as Record<string, unknown>;
  if (typeof r.role !== 'string') return { ok: false, error: 'role missing' };
  for (const k of ['strengths', 'weaknesses', 'recommendations']) {
    const arr = r[k];
    if (!Array.isArray(arr) || arr.length > 6) return { ok: false, error: `${k} must be array len<=6` };
    if (!arr.every((s) => typeof s === 'string' && s.length <= 200)) return { ok: false, error: `${k} item invalid` };
  }
  if (!['low', 'medium', 'high'].includes(r.risk_level as string)) return { ok: false, error: 'risk_level invalid' };
  return { ok: true, value: raw as MemberReport };
}

async function runMember(role: CommitteeRole, reportJson: string, llm: LLMClient): Promise<MemberReport | MemberError> {
  const messages = [
    { role: 'system', content: role.systemPrompt + '\n\n' + MEMBER_OUTPUT_RULES },
    { role: 'user', content: `Repo report:\n\n${reportJson}` },
  ];
  const callOnce = async (extra = ''): Promise<unknown> => {
    const m = extra
      ? [{ role: 'system', content: role.systemPrompt + '\n\n' + MEMBER_OUTPUT_RULES + '\n\n' + extra }, ...messages.slice(1)]
      : messages;
    const raw = await llm.chat(m, { model: role.model });
    return tryParseJSON(raw);
  };

  let parsed: unknown;
  try { parsed = await callOnce(); }
  catch (e: any) { return { role: role.role, error: `LLM call failed: ${e?.message ?? e}` }; }

  let v = validateMemberReport(parsed);
  if (v.ok) { v.value.role = role.role; return v.value; }

  try {
    parsed = await callOnce(`Your previous response failed validation: ${v.error}. Return strictly valid JSON now.`);
  } catch (e: any) {
    return { role: role.role, error: `LLM retry failed: ${e?.message ?? e}` };
  }
  v = validateMemberReport(parsed);
  if (v.ok) { v.value.role = role.role; return v.value; }
  return { role: role.role, error: `validation failed twice: ${v.error}` };
}

const SYNTH_SYSTEM = `You are synthesizing three committee member reports on the same repository.
Return ONE JSON object with this exact shape (no prose, no fence):
{
  "consensus": [{"topic": string, "agreeing_roles": string[]}],
  "dissents": [{"topic": string, "positions": [{"role": string, "position": string}]}],
  "combined_recommendations": string[],
  "overall_risk": "low" | "medium" | "high"
}

Rules:
- A "consensus" item is a topic at least 2 of the 3 roles agree on (mention which).
- A "dissent" item is a topic where roles disagree explicitly. Surface them — do NOT average opinions.
- "combined_recommendations" merges actionable items, deduplicating near-duplicates.
- "overall_risk" is the highest of the member risk_levels by default; downgrade only if dissents resolve in lower direction.
- Output JSON only.`;

function validateSynthesis(raw: unknown): { ok: true; value: CommitteeSynthesis } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not object' };
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.consensus)) return { ok: false, error: 'consensus must be array' };
  for (const c of r.consensus) {
    const o = c as Record<string, unknown>;
    if (typeof o?.topic !== 'string') return { ok: false, error: 'consensus.topic invalid' };
    if (!Array.isArray(o?.agreeing_roles) || !o.agreeing_roles.every((x) => typeof x === 'string'))
      return { ok: false, error: 'consensus.agreeing_roles invalid' };
  }
  if (!Array.isArray(r.dissents)) return { ok: false, error: 'dissents must be array' };
  for (const d of r.dissents) {
    const o = d as Record<string, unknown>;
    if (typeof o?.topic !== 'string') return { ok: false, error: 'dissents.topic invalid' };
    if (!Array.isArray(o?.positions)) return { ok: false, error: 'dissents.positions invalid' };
    for (const p of o.positions) {
      const x = p as Record<string, unknown>;
      if (typeof x?.role !== 'string' || typeof x?.position !== 'string') return { ok: false, error: 'dissent.position invalid' };
    }
  }
  if (!Array.isArray(r.combined_recommendations) || !r.combined_recommendations.every((x) => typeof x === 'string'))
    return { ok: false, error: 'combined_recommendations invalid' };
  if (!['low', 'medium', 'high'].includes(r.overall_risk as string)) return { ok: false, error: 'overall_risk invalid' };
  return { ok: true, value: raw as CommitteeSynthesis };
}

export interface CommitteeOptions {
  llm: LLMClient;
  roles?: CommitteeRole[];
  synthModel?: string;
}

export interface CommitteeResult {
  members: (MemberReport | MemberError)[];
  synthesis: CommitteeSynthesis | { error: string };
}

export class Committee {
  private llm: LLMClient;
  private roles: CommitteeRole[];
  private synthModel: string;

  constructor(opts: CommitteeOptions) {
    this.llm = opts.llm;
    this.roles = opts.roles ?? DEFAULT_ROLES;
    this.synthModel = opts.synthModel ?? 'claude-opus-4-7';
  }

  async review(reportJson: string): Promise<CommitteeResult> {
    const members = await Promise.all(this.roles.map((r) => runMember(r, reportJson, this.llm)));

    const userPrompt =
      'Three member reports (JSON array):\n\n' + JSON.stringify(members, null, 2);

    const callOnce = async (extra = ''): Promise<unknown> => {
      const raw = await this.llm.chat(
        [
          { role: 'system', content: SYNTH_SYSTEM + (extra ? '\n\n' + extra : '') },
          { role: 'user', content: userPrompt },
        ],
        { model: this.synthModel },
      );
      return tryParseJSON(raw);
    };

    let parsed: unknown;
    try { parsed = await callOnce(); }
    catch (e: any) { return { members, synthesis: { error: `synth call failed: ${e?.message ?? e}` } }; }

    let v = validateSynthesis(parsed);
    if (v.ok) return { members, synthesis: v.value };

    try {
      parsed = await callOnce(`Your previous response failed validation: ${v.error}. Return strictly valid JSON now.`);
    } catch (e: any) {
      return { members, synthesis: { error: `synth retry failed: ${e?.message ?? e}` } };
    }
    v = validateSynthesis(parsed);
    if (v.ok) return { members, synthesis: v.value };
    return { members, synthesis: { error: `synth validation failed twice: ${v.error}` } };
  }
}
