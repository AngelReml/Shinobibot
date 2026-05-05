// Habilidad B.3 — /improvements + /apply.
// Lee el último committee_reports/<ts>.json y produce propuestas concretas
// (archivo afectado, motivo, diff exacto, riesgo) en proposals/<ts>.md.
// /apply <id> aplica una propuesta tras confirmación humana.

import * as fs from 'fs';
import * as path from 'path';
import { tryParseJSON } from '../reader/schemas.js';
import { makeLLMClient } from '../reader/llm_adapter.js';
import type { LLMClient } from '../reader/SubAgent.js';

export interface Proposal {
  id: string;
  file: string;
  motive: string;
  risk: 'low' | 'medium' | 'high';
  diff: string;             // unified diff hunks
}

const SYSTEM_PROMPT = `You translate committee recommendations into concrete code-change proposals.

For each recommendation that is implementable as a code or doc change, produce ONE proposal.
Skip recommendations that are aspirational or require human discussion.

Return a JSON object of this exact shape (no prose, no fence):
{
  "proposals": [
    {
      "id": string (slug, lowercase-dashes, unique within the response),
      "file": string (path relative to repo root),
      "motive": string (max 250 chars, why this change addresses the recommendation),
      "risk": "low" | "medium" | "high",
      "diff": string (unified diff hunks ONLY, with --- a/<file> +++ b/<file> headers)
    }
  ]
}

Diff rules:
- Use unified-diff format with @@ hunk headers and a/ b/ prefixes.
- For new files, use --- /dev/null and +++ b/<path>.
- Touch ONLY the file in "file"; do not bundle multi-file diffs in one proposal.
- Keep diffs SMALL and reviewable. If a recommendation needs >100 changed lines, propose a stub or a doc-level proposal instead.
- Do NOT invent symbols; if you don't know the surrounding code, propose a small additive change (new file, new section in README, new test stub).
- Output JSON only.`;

function validateProposal(raw: unknown): raw is Proposal {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(r.id)) return false;
  if (typeof r.file !== 'string' || r.file.length === 0) return false;
  if (typeof r.motive !== 'string' || r.motive.length > 250) return false;
  if (!['low', 'medium', 'high'].includes(r.risk as string)) return false;
  if (typeof r.diff !== 'string' || !r.diff.includes('@@')) return false;
  return true;
}

export async function generateProposals(committeeReportPath: string, llm: LLMClient): Promise<{ ok: boolean; proposals: Proposal[]; error?: string }> {
  const raw = fs.readFileSync(committeeReportPath, 'utf-8');
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Committee report (JSON):\n\n${raw}` },
  ];
  let parsed: any;
  try {
    const txt = await llm.chat(messages, { model: 'claude-opus-4-7' });
    parsed = tryParseJSON(txt);
  } catch (e: any) {
    return { ok: false, proposals: [], error: `LLM call failed: ${e?.message ?? e}` };
  }
  const arr = parsed?.proposals;
  if (!Array.isArray(arr)) return { ok: false, proposals: [], error: 'response.proposals not array' };
  const valid = arr.filter(validateProposal);
  return { ok: valid.length > 0, proposals: valid };
}

export function findLatestCommitteeReport(): string | undefined {
  const dir = path.join(process.cwd(), 'committee_reports');
  if (!fs.existsSync(dir)) return undefined;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) return undefined;
  return path.join(dir, files[files.length - 1]);
}

function renderProposalsMarkdown(proposals: Proposal[], source: string): string {
  const lines: string[] = [];
  lines.push(`# Proposals — derived from ${path.basename(source)}`);
  lines.push('');
  lines.push(`Generated ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`> Apply with: \`/apply <id>\` (per proposal). NO change is auto-applied.`);
  lines.push('');
  for (const p of proposals) {
    lines.push(`---`);
    lines.push('');
    lines.push(`## \`${p.id}\``);
    lines.push('');
    lines.push(`- **file**: \`${p.file}\``);
    lines.push(`- **risk**: ${p.risk}`);
    lines.push(`- **motive**: ${p.motive}`);
    lines.push('');
    lines.push('```diff');
    lines.push(p.diff.trimEnd());
    lines.push('```');
    lines.push('');
  }
  return lines.join('\n');
}

export interface RunImprovementsResult {
  ok: boolean;
  proposalsPath: string;
  proposals: Proposal[];
}

export async function runImprovements(committeeReportPath?: string): Promise<RunImprovementsResult> {
  const target = committeeReportPath ?? findLatestCommitteeReport();
  if (!target) {
    console.log('[improvements] no committee_reports/ found — run /committee first');
    return { ok: false, proposalsPath: '', proposals: [] };
  }
  console.log(`[improvements] reading: ${target}`);
  console.log('[improvements] generating proposals via Opus…');

  const { ok, proposals, error } = await generateProposals(target, makeLLMClient());
  if (!ok) {
    console.log(`[improvements] failed: ${error ?? 'no valid proposals'}`);
    return { ok: false, proposalsPath: '', proposals: [] };
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(process.cwd(), 'proposals');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const mdPath = path.join(dir, `${ts}.md`);
  const jsonPath = path.join(dir, `${ts}.json`);
  fs.writeFileSync(mdPath, renderProposalsMarkdown(proposals, target));
  fs.writeFileSync(jsonPath, JSON.stringify({ source: target, proposals }, null, 2));

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`PROPOSALS — ${proposals.length} item(s)`);
  console.log('═══════════════════════════════════════════════════════════════');
  for (const p of proposals) {
    console.log(`  [${p.risk.padEnd(6)}] ${p.id}  →  ${p.file}`);
    console.log(`           ${p.motive}`);
  }
  console.log('');
  console.log(`[improvements] markdown: ${mdPath}`);
  console.log(`[improvements] machine:  ${jsonPath}`);
  console.log(`[improvements] To apply one: /apply ${proposals[0]?.id ?? '<id>'}`);
  console.log('');
  return { ok: true, proposalsPath: mdPath, proposals };
}

// /apply uses the latest proposals/<ts>.json — never the markdown.
function findLatestProposalsJson(): string | undefined {
  const dir = path.join(process.cwd(), 'proposals');
  if (!fs.existsSync(dir)) return undefined;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) return undefined;
  return path.join(dir, files[files.length - 1]);
}

export interface ApplyResult {
  ok: boolean;
  message: string;
  proposalId: string;
}

import { spawnSync } from 'child_process';
import * as os from 'os';

export async function applyProposal(id: string, asker: (q: string) => Promise<string>): Promise<ApplyResult> {
  const jsonPath = findLatestProposalsJson();
  if (!jsonPath) return { ok: false, message: 'no proposals/ found — run /improvements first', proposalId: id };
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const list: Proposal[] = raw.proposals ?? [];
  const p = list.find((x) => x.id === id);
  if (!p) return { ok: false, message: `proposal '${id}' not found in ${path.basename(jsonPath)}`, proposalId: id };

  console.log('');
  console.log(`Proposal: ${p.id}`);
  console.log(`  file:   ${p.file}`);
  console.log(`  risk:   ${p.risk}`);
  console.log(`  motive: ${p.motive}`);
  console.log('');
  console.log('--- DIFF ---');
  console.log(p.diff);
  console.log('--- END ---');
  console.log('');

  const ans = (await asker('Apply this proposal? [y/N]: ')).trim().toLowerCase();
  if (ans !== 'y' && ans !== 'yes' && ans !== 's' && ans !== 'si') {
    return { ok: false, message: 'aborted by user', proposalId: id };
  }

  // Persist diff to temp and run `git apply` for safety.
  const tmpFile = path.join(os.tmpdir(), `shinobi-apply-${Date.now()}.patch`);
  fs.writeFileSync(tmpFile, p.diff.endsWith('\n') ? p.diff : p.diff + '\n');
  const res = spawnSync('git', ['apply', '--whitespace=nowarn', tmpFile], {
    cwd: process.cwd(),
    encoding: 'utf-8',
  });
  fs.unlinkSync(tmpFile);
  if (res.status !== 0) {
    return {
      ok: false,
      message: `git apply failed: ${(res.stderr || res.stdout || '').trim()}`,
      proposalId: id,
    };
  }
  return { ok: true, message: `applied — review with 'git diff' and commit if good`, proposalId: id };
}
