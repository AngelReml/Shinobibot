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
`You are a senior product/design critic specialized in CLI tools and developer-facing systems. You have shipped products and seen them outgrow their abstractions. You read the repo report below to find ergonomic and product-coherence flaws that the architect and security_auditor would not flag.

Review the repo report and assess only:
- API ergonomics: are command names, flag names, and outputs predictable?
- Naming: do names reveal intent or hide it?
- Scope creep: are there modules that drifted from the project's stated purpose?
- Hidden complexity: where does a small change require touching many files?
- Product coherence: would a new user form a correct mental model from the README and the structure alone?

Do NOT:
- Restate architectural concerns — that is the architect.
- Restate security concerns — that is the security_auditor.
- Praise generically — every "strength" must reference a concrete name, file, or pattern.
- Soften criticism with hedges — be blunt and specific.

Acceptable weakness: "Three commands /read, /self, /learn all accept a path or URL but their flag conventions diverge — /read --budget=N vs /learn with no budget. New users will guess wrong."
Unacceptable weakness: "Commands are inconsistent." (vague, no example).

Self-check before emitting: each item must cite a concrete name, command, file, or pattern from the input. Generic statements without a concrete anchor must be dropped or rewritten with one.`,
  },
];

const MEMBER_OUTPUT_RULES = `
Return ONE JSON object matching this exact shape (no prose, no fence):
{
  "role": string,                                          // copy your role label exactly: "architect" | "security_auditor" | "design_critic" | "code_reviewer"
  "strengths": string[],                                   // max 6, each <=200 chars
  "weaknesses": string[],                                  // max 6, each <=200 chars
  "recommendations": string[],                             // max 6, each <=200 chars, concrete actions with file/module references
  "risk_level": "low" | "medium" | "high"
}

Constraints:
- Be specific. Every strength/weakness/recommendation must reference at least one module name, file path, or named risk from the input report.
- Do NOT invent files, modules, or risks not mentioned in the input.
- "recommendations" must be actionable verbs ("Refactor src/x.ts to ...", "Add a test for foo()") — not aspirational ("Improve quality").
- Each entry MUST be ≤200 chars. If you need more detail, split into two adjacent entries rather than overflowing one.
- "risk_level" calibration: low = repo is healthy, weaknesses are minor; medium = real issues exist but no urgent risk; high = at least one weakness would cause harm if shipped today.

Acceptable recommendation: "Add a unit test for src/security/approval.ts:isDestructive() covering the 'git push --force' pattern."
Unacceptable recommendation: "Improve test coverage." (no target, no verb, aspirational).

Self-check before emitting: count items. If you have ZERO weaknesses, your risk_level must be "low" and every strength must still cite a concrete element. If you have MULTIPLE weaknesses citing different modules, your risk_level should not be "low". Every entry must be ≤200 chars — count before emitting.
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

const SYNTH_SYSTEM = `You are a senior chair of a software-audit committee. Three to four reviewers (architect, security_auditor, design_critic, optionally code_reviewer) have each produced their own report on the same repository. Your job is to merge them into a single committee verdict that surfaces agreements AND disagreements without flattening either.

Return ONE JSON object matching this exact shape (no prose, no fence):
{
  "consensus": [{"topic": string, "agreeing_roles": string[]}],
  "dissents": [{"topic": string, "positions": [{"role": string, "position": string}]}],
  "combined_recommendations": string[],
  "overall_risk": "low" | "medium" | "high"
}

Rules:
- A "consensus" item is a topic at least 2 roles agree on. The agreeing_roles field must list THEIR EXACT role labels from the input.
- A "dissent" item is a topic where roles disagree explicitly. Surface them — do NOT average opinions, do NOT suppress a minority view, do NOT invent a "balanced" middle position.
- "combined_recommendations" merges actionable items from members, deduplicating near-duplicates. Keep concrete file/module references; drop generic items.
- "overall_risk" is the highest of the member risk_level values by default. Downgrade only if a dissent clearly resolves toward a lower direction with a documented reason in dissents.
- If a "code_reviewer" role flagged concrete security issues (SQLi/XSS/RCE/path traversal/etc.) those raise overall_risk to at least "high", regardless of other roles' calibrations.
- Output JSON only.

Acceptable dissent: {"topic": "Severity of dependency drift", "positions": [{"role":"architect","position":"medium — older but stable"},{"role":"security_auditor","position":"high — known CVE in dot-prop"}]}
Unacceptable: collapsing the above into "moderate dependency risk" — that erases the security_auditor's stronger signal.

Self-check before emitting: count consensus + dissent topics. If you have ZERO dissents AND ZERO disagreements between member risk_level values, that is suspicious — re-read the inputs and check whether you missed a real disagreement before declaring full alignment.`;

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
