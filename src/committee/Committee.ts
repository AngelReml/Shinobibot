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
  /** F1 — set when majority voting runs the committee 3x and aggregates. */
  verdict_confidence?: 'high' | 'medium' | 'low';
  /** F1 — per-run risks captured by the voting wrapper. */
  voting_runs?: { run: number; overall_risk: 'low' | 'medium' | 'high' }[];
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
`You are a senior software architect specialized in long-lived multi-agent systems and runtime architecture. You have audited dozens of LLM agent codebases. You read the repo report below as a peer architect, not as a fan. Be precise, not polite.

Review the repo report and assess:
- Structural soundness: do module boundaries hold? Is there a clear core vs. periphery?
- Coupling: which modules know too much about which?
- Architectural risks: where would a new feature in 6 months hurt?
- Long-term sense: is this organized for the project's stated purpose, or has it drifted?

Do NOT:
- Comment on cosmetic code style — that is design_critic territory.
- Suggest security fixes — that is security_auditor territory.
- Recommend "more tests" without naming the specific module that lacks them.
- Hedge with "could be" / "maybe" / "perhaps" — commit to a position or say "insufficient evidence".

Acceptable weakness: "src/coordinator/orchestrator.ts and src/runtime/resident_loop.ts share a 'currentMissionId' global; ownership is unclear, leading to race risk in concurrent runs."
Unacceptable weakness: "The architecture could be improved." (vague, untraceable).

Self-check before emitting strengths/weaknesses/recommendations: each item must reference at least one module name or path from the input report. If you can't name what you're talking about, drop the item.`,
  },
  {
    role: 'security_auditor',
    model: 'claude-haiku-4-5',
    systemPrompt:
`You are a senior application security auditor with field experience in LLM agent runtimes and tool-using systems. You read the repo report below to find risks that the architect and design_critic would miss.

Review the repo report and assess only:
- Attack surface: which entry points accept untrusted input?
- Secret handling: where do credentials live and how are they accessed?
- Command execution: where does the system spawn processes or eval code?
- File system access: where can an LLM-driven path land outside the workspace?
- Dependency risk: which third-party packages are critical and unaudited?

Do NOT:
- Comment on architectural elegance or naming — out of scope.
- Demand "more tests" generically — name the specific risky path that lacks coverage.
- Use the word "vulnerable" without naming the module and the vector.
- Default to severity HIGH for everything to look thorough — calibrate honestly.

Acceptable weakness: "src/audit/runAudit.ts:240 spawns 'git apply' on untrusted patch content from LLM output; if a malicious diff slipped past committee, it could write outside the repo."
Unacceptable weakness: "The system has security risks." (vague, no vector).

Self-check before emitting: every weakness must name a file path AND describe the vector (input source → action). If you can't give both, drop the item or move it to recommendations as a generic hardening step.`,
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

async function runMember(role: CommitteeRole, reportJson: string, llm: LLMClient, temperature?: number): Promise<MemberReport | MemberError> {
  const messages = [
    { role: 'system', content: role.systemPrompt + '\n\n' + MEMBER_OUTPUT_RULES },
    { role: 'user', content: `Repo report:\n\n${reportJson}` },
  ];
  const callOnce = async (extra = ''): Promise<unknown> => {
    const m = extra
      ? [{ role: 'system', content: role.systemPrompt + '\n\n' + MEMBER_OUTPUT_RULES + '\n\n' + extra }, ...messages.slice(1)]
      : messages;
    const raw = await llm.chat(m, { model: role.model, temperature });
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

const SYNTH_SYSTEM = `You are synthesizing committee member reports on the same repository.
Return ONE JSON object with this exact shape (no prose, no fence):
{
  "consensus": [{"topic": string, "agreeing_roles": string[]}],
  "dissents": [{"topic": string, "positions": [{"role": string, "position": string}]}],
  "combined_recommendations": string[],
  "overall_risk": "low" | "medium" | "high"
}

Rules:
- A "consensus" item is a topic at least 2 roles agree on (mention which).
- A "dissent" item is a topic where roles disagree explicitly. Surface them — do NOT average opinions.
- "combined_recommendations" merges actionable items, deduplicating near-duplicates.
- "overall_risk" is the highest of the member risk_levels by default; downgrade only if dissents resolve in lower direction.
- If a "code_reviewer" role flagged concrete security issues (SQLi/XSS/etc.) those raise overall_risk to at least "high".
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
  /** F1 — when true, run the committee 3 times and majority-vote the verdict. Default false. */
  votingRuns?: number;
  /** F1 — when set, every member call uses this temperature (default undefined → provider default). */
  temperature?: number;
}

export interface CommitteeResult {
  members: (MemberReport | MemberError)[];
  synthesis: CommitteeSynthesis | { error: string };
}

export class Committee {
  private llm: LLMClient;
  private roles: CommitteeRole[];
  private synthModel: string;
  private votingRuns: number;
  private temperature?: number;

  constructor(opts: CommitteeOptions) {
    this.llm = opts.llm;
    this.roles = opts.roles ?? DEFAULT_ROLES;
    this.synthModel = opts.synthModel ?? 'claude-opus-4-7';
    this.votingRuns = Math.max(1, opts.votingRuns ?? 1);
    this.temperature = opts.temperature;
  }

  /** Single committee pass (3 members + 1 synthesis). Used by voting wrapper. */
  private async runOnce(reportJson: string): Promise<CommitteeResult> {
    const members = await Promise.all(this.roles.map((r) => runMember(r, reportJson, this.llm, this.temperature)));

    const userPrompt =
      `Member reports (${members.length}, JSON array):\n\n` + JSON.stringify(members, null, 2);

    const callOnce = async (extra = ''): Promise<unknown> => {
      const raw = await this.llm.chat(
        [
          { role: 'system', content: SYNTH_SYSTEM + (extra ? '\n\n' + extra : '') },
          { role: 'user', content: userPrompt },
        ],
        { model: this.synthModel, temperature: this.temperature },
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

  async review(reportJson: string): Promise<CommitteeResult> {
    if (this.votingRuns <= 1) return this.runOnce(reportJson);

    // F1 — majority voting: run committee N times, vote the verdict.
    const runs: CommitteeResult[] = [];
    for (let i = 0; i < this.votingRuns; i++) runs.push(await this.runOnce(reportJson));

    // Take members from the first successful run (their content is intra-run consistent).
    const baseMembers = runs.find((r) => !('error' in r.synthesis))?.members ?? runs[0].members;
    const validSyntheses = runs
      .map((r) => r.synthesis)
      .filter((s): s is CommitteeSynthesis => !('error' in s));

    if (validSyntheses.length === 0) {
      return { members: baseMembers, synthesis: { error: 'all voting runs failed synthesis' } };
    }

    // Vote on overall_risk.
    const tally: Record<'low' | 'medium' | 'high', number> = { low: 0, medium: 0, high: 0 };
    for (const s of validSyntheses) tally[s.overall_risk] += 1;
    const winningRisk = (Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0]) as 'low' | 'medium' | 'high';
    const winningCount = tally[winningRisk];
    const total = validSyntheses.length;
    const confidence: 'high' | 'medium' | 'low' =
      winningCount === total ? 'high' :
      winningCount >= Math.ceil(total / 2) + (total % 2 === 0 ? 0 : 0) ? 'medium' :
      'low';
    // Above: high = unanimous; medium = majority; low = plurality only.
    const sharperConfidence: 'high' | 'medium' | 'low' =
      winningCount === total ? 'high' :
      winningCount > total / 2 ? 'medium' :
      'low';

    // Aggregate dissents/consensus/recommendations across runs.
    const consensusMap = new Map<string, Consensus>();
    const dissentMap = new Map<string, Dissent>();
    const recsSet = new Set<string>();
    for (const s of validSyntheses) {
      for (const c of s.consensus) {
        if (!consensusMap.has(c.topic)) consensusMap.set(c.topic, c);
      }
      for (const d of s.dissents) {
        if (!dissentMap.has(d.topic)) dissentMap.set(d.topic, d);
      }
      for (const r of s.combined_recommendations) recsSet.add(r);
    }

    const synthesis: CommitteeSynthesis = {
      consensus: [...consensusMap.values()],
      dissents: [...dissentMap.values()],
      combined_recommendations: [...recsSet],
      overall_risk: winningRisk,
      verdict_confidence: sharperConfidence,
      voting_runs: validSyntheses.map((s, i) => ({ run: i + 1, overall_risk: s.overall_risk })),
    };
    return { members: baseMembers, synthesis };
  }
}
