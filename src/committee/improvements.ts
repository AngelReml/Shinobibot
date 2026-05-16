// Habilidad B.3 — /improvements + /apply.
// Lee el último committee_reports/<ts>.json y produce propuestas concretas
// (archivo afectado, motivo, diff exacto, riesgo) en proposals/<ts>.md.
// /apply <id> aplica una propuesta tras confirmación humana.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { tryParseJSON } from '../reader/schemas.js';
import { makeLLMClient } from '../reader/llm_adapter.js';
import type { LLMClient } from '../reader/SubAgent.js';

export interface Proposal {
  id: string;
  file: string;
  motive: string;
  risk: 'low' | 'medium' | 'high';
  diff: string;             // unified diff hunks
  /** F3 — populated by checkProposalApplicability(). */
  applicability?: 'ok' | 'fuzzy' | 'broken';
  /** F3 — error from `git apply --check` when applicability != ok. */
  apply_error?: string;
}

const SYSTEM_PROMPT = `You are a senior code-mod author who turns committee feedback into small, applicable, reviewable patches. Each proposal is a single hunk against a single file. Your patches will be checked with "git apply --check" before any human sees them, and broken patches are silently dropped — so spend your effort on accuracy, not volume.

Aim for AT LEAST 5 proposals (one per recommendation that is implementable as a code or doc change).
Skip recommendations that are aspirational or require human discussion.

Return a JSON object of this exact shape (no prose, no fence):
{
  "proposals": [
    {
      "id": string (slug, lowercase-dashes, unique within the response),
      "file": string (path relative to repo root, MUST exist as currently committed),
      "motive": string (max 250 chars, why this change addresses the recommendation),
      "risk": "low" | "medium" | "high",
      "diff": string (unified diff hunks ONLY, with --- a/<file> +++ b/<file> headers)
    }
  ]
}

Unified diff format — MANDATORY (this is what git apply expects):
- Use \`---\` a/<file> and \`+++\` b/<file> on separate lines before the @@ block.
- Each hunk header MUST be exactly: \`@@ -<start>,<count> +<start>,<count> @@\`
  where <start> is the 1-indexed line in the original file where the hunk begins,
  and <count> is the number of context+removed lines (left side) or context+added lines (right side).
- For NEW files, the header is \`@@ -0,0 +1,<count> @@\` where <count> is the number of lines added.
- A bare \`@@\` with no numbers is INVALID — git apply will reject the patch with "corrupt patch at line N".
- A single-number form like \`@@ -27 +27 @@\` (missing comma+count) is also rejected by modern git.
- Count actual lines yourself: 3 lines of context + 1 removed line + 1 added line = \`@@ -L,4 +L,4 @@\` (4 on each side).

Other rules:
- Touch ONLY the file in "file"; do not bundle multi-file diffs in one proposal.
- Keep diffs SMALL and reviewable. If a recommendation needs >100 changed lines, propose a stub or a doc-level proposal instead.
- Do NOT invent symbols. If you don't have the surrounding code in your context, prefer additive proposals (new file, new section in README, new test stub) over edits to unknown source.
- Do NOT bundle multiple unrelated motives in one proposal — split them.
- Output JSON only.

Acceptable proposal (modifies an existing file with valid @@ counters):
{
  "id": "add-test-script",
  "file": "package.json",
  "motive": "Replace placeholder test script so 'npm test' runs a real command.",
  "risk": "low",
  "diff": "--- a/package.json\\n+++ b/package.json\\n@@ -27,7 +27,7 @@\\n   \\"scripts\\": {\\n     \\"start\\": \\"ts-node src/index.ts\\",\\n     \\"dev\\": \\"ts-node-dev --respawn --transpile-only src/index.ts\\",\\n-    \\"test\\": \\"echo \\\\\\"Error: no test specified\\\\\\" && exit 1\\"\\n+    \\"test\\": \\"tsx scripts/run_tests.ts\\"\\n   },\\n   \\"keywords\\": [],\\n   \\"author\\": \\"AngelReml\\"\\n"
}

Acceptable new-file proposal (use /dev/null on the left):
{
  "id": "add-readme-section",
  "file": "docs/foo.md",
  "motive": "Add foo doc as agreed by committee.",
  "risk": "low",
  "diff": "--- /dev/null\\n+++ b/docs/foo.md\\n@@ -0,0 +1,3 @@\\n+# Foo\\n+\\n+This document covers foo.\\n"
}

Unacceptable diffs (rejected by git apply --check — DO NOT emit):
- \`@@\\n+content\` (bare @@, no counters) → "corrupt patch"
- \`@@ -27 +27 @@\` (single number, missing comma+count) → "corrupt patch"
- \`--- a/missing.ts\\n+++ b/missing.ts\\n@@ -1,1 +1,1 @@\` referring to a file path you have never seen

Self-check before emitting each proposal: (a) the file path must look real (no obviously invented paths if you don't know they exist); (b) the @@ header MUST contain \`-<num>,<num> +<num>,<num>\` numbers, NOT bare \`@@\`, NOT single numbers; (c) every line of context must be something you have actually seen in the input or in a doc you cited. If any of the three fails, drop the proposal.`;

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
    const txt = await llm.chat(messages, { model: 'claude-sonnet-4-6' });
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

function applicabilityTag(p: Proposal): string {
  switch (p.applicability) {
    case 'ok': return '[OK]';
    case 'fuzzy': return '[FUZZY]';
    case 'broken': return '[BROKEN_DIFF]';
    default: return '[UNCHECKED]';
  }
}

function renderProposalsMarkdown(proposals: Proposal[], source: string): string {
  const lines: string[] = [];
  lines.push(`# Proposals — derived from ${path.basename(source)}`);
  lines.push('');
  lines.push(`Generated ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`> Apply with: \`/apply <id>\` (per proposal). NO change is auto-applied.`);
  lines.push(`> Tags: \`[OK]\` applies cleanly · \`[FUZZY]\` applies via 3-way merge · \`[BROKEN_DIFF]\` will not apply.`);
  lines.push('');
  for (const p of proposals) {
    lines.push(`---`);
    lines.push('');
    lines.push(`## \`${p.id}\` ${applicabilityTag(p)}`);
    lines.push('');
    lines.push(`- **file**: \`${p.file}\``);
    lines.push(`- **risk**: ${p.risk}`);
    lines.push(`- **applicability**: ${p.applicability ?? 'unchecked'}${p.apply_error ? `  *(${p.apply_error})*` : ''}`);
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

  const llm = makeLLMClient({ temperature: 0 });
  const { ok, proposals, error } = await generateProposals(target, llm);
  if (!ok) {
    console.log(`[improvements] failed: ${error ?? 'no valid proposals'}`);
    return { ok: false, proposalsPath: '', proposals: [] };
  }

  // F3 — verifica aplicabilidad. Si el path es inventado (no existe), intenta
  // resolver por basename via git ls-files. Si el diff esta corrupto/desactualizado,
  // pide a Opus un find/replace y reconstruye el patch via `git diff`.
  for (const p of proposals) {
    if (!fs.existsSync(p.file)) {
      const resolved = resolveByBasename(p.file);
      if (resolved) p.file = resolved;
    }
    let r = checkProposalApplicability(p);
    if (r.applicability === 'broken' && fs.existsSync(p.file)) {
      try {
        const fileContent = fs.readFileSync(p.file, 'utf-8').slice(0, 12_000);
        const repaired = await regenerateProposalWithContext(p, fileContent, llm);
        if (repaired) {
          p.diff = repaired.diff;
          r = checkProposalApplicability(p);
        }
      } catch { /* tolerate retry failure; keep broken */ }
    }
    p.applicability = r.applicability;
    p.apply_error = r.error;
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
    console.log(`  ${applicabilityTag(p).padEnd(14)} [${p.risk.padEnd(6)}] ${p.id}  →  ${p.file}`);
    console.log(`           ${p.motive}`);
    if (p.apply_error) console.log(`           ↳ ${p.apply_error}`);
  }
  console.log('');
  const firstApplicable = proposals.find((p) => p.applicability === 'ok' || p.applicability === 'fuzzy');
  console.log(`[improvements] markdown: ${mdPath}`);
  console.log(`[improvements] machine:  ${jsonPath}`);
  console.log(`[improvements] To apply: /apply ${firstApplicable?.id ?? proposals[0]?.id ?? '<id>'}`);
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

/**
 * F3 — fallback path resolver for proposals where Opus invented a path that
 * does not exist (e.g. "src/hermes_watcher.ts" when the real file is at
 * "src/watchers/hermes_watcher.ts"). Uses git's index for a fast lookup.
 */
function resolveByBasename(invented: string): string | undefined {
  const base = path.basename(invented);
  if (!base) return undefined;
  const r = spawnSync('git', ['ls-files', `*/${base}`, base], { encoding: 'utf-8' });
  if (r.status !== 0) return undefined;
  const matches = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (matches.length === 0) return undefined;
  matches.sort((a, b) => a.length - b.length);
  return matches[0];
}

/**
 * F3 — second-chance regeneration when the first diff did not apply.
 * Asks Opus for {find, replace} (much more robust than getting unified-diff
 * @@ counters right) and lets `git diff` reconstruct a syntactically valid
 * patch from before/after files.
 */
export async function regenerateProposalWithContext(p: Proposal, fileContent: string, llm: LLMClient): Promise<{ diff: string } | undefined> {
  const sys = `You are a senior code-mod author repairing a previous failed proposal. The previous diff did NOT apply with "git apply". You are getting a second chance with the LITERAL contents of the target file below. Your task: produce a precise find/replace pair that, when applied via simple substring replacement, achieves the original motive.

Output JSON ONLY in this shape:
{"find": string, "replace": string}

Rules:
- "find" MUST be an EXACT, contiguous substring of the file shown below — copy it verbatim including whitespace, indentation, and quotes.
- "find" must be UNIQUE in the file. If the substring you'd pick appears more than once, expand it with adjacent lines until it is unique.
- "replace" is what "find" should become. It can be longer or shorter than "find".
- Keep the change small and focused on the motive — do NOT bundle unrelated edits.
- For pure additions (e.g. add a new section), set "find" to a unique anchor line that already exists, and set "replace" to that anchor line PLUS the new content (preserving original indentation).
- Output JSON only — no prose, no fence.

Acceptable: {"find":"  \\"test\\": \\"echo \\\\\\"Error: no test specified\\\\\\" && exit 1\\"","replace":"  \\"test\\": \\"tsx scripts/run_tests.ts\\""}
Unacceptable: a "find" that says "scripts: { test: ... }" when the actual file uses double quotes and different indentation — substring match will fail and the retry is wasted.

Self-check before emitting: copy your "find" and ctrl-F it mentally in the file content above. If you don't see it letter-for-letter, fix it. If it appears more than once, add context until unique.`;
  const user =
    `Motive: ${p.motive}\n` +
    `Risk: ${p.risk}\n` +
    `Target file: ${p.file}\n\n` +
    `--- BEGIN ${p.file} (literal contents up to 12k chars) ---\n` +
    fileContent +
    `\n--- END ${p.file} ---`;
  let raw: string;
  try {
    raw = await llm.chat(
      [{ role: 'system', content: sys }, { role: 'user', content: user }],
      { model: 'claude-sonnet-4-6', temperature: 0 },
    );
  } catch { return undefined; }
  let parsed: any;
  try { parsed = tryParseJSON(raw); } catch { return undefined; }
  if (!parsed || typeof parsed.find !== 'string' || typeof parsed.replace !== 'string') return undefined;

  const fileAbs = path.resolve(p.file);
  if (!fs.existsSync(fileAbs)) return undefined;
  const original = fs.readFileSync(fileAbs, 'utf-8');

  let patched: string | undefined;
  if (original.includes(parsed.find)) {
    patched = original.replace(parsed.find, parsed.replace);
  } else {
    const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
    const targetNorm = normalize(parsed.find);
    if (targetNorm.length < 10) return undefined;
    const lines = original.split(/\n/);
    const findLines = parsed.find.split(/\n/).length;
    outer: for (let len = Math.max(1, findLines - 1); len <= findLines + 1; len++) {
      for (let i = 0; i + len <= lines.length; i++) {
        const window = lines.slice(i, i + len).join('\n');
        if (normalize(window) === targetNorm) {
          patched = lines.slice(0, i).concat([parsed.replace], lines.slice(i + len)).join('\n');
          break outer;
        }
      }
    }
    if (patched === undefined) return undefined;
  }
  if (patched === original) return undefined;

  // Diff vía `git diff --no-index` entre dos temporales. NUNCA se escribe
  // sobre el archivo real del repo (bug P1: el código anterior escribía
  // `patched` sobre el fichero y luego lo revertía — si el proceso moría a
  // medias, el repo del usuario quedaba modificado sin haberlo pedido).
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpOrig = path.join(os.tmpdir(), `shinobi-orig-${stamp}`);
  const tmpPatched = path.join(os.tmpdir(), `shinobi-patched-${stamp}`);
  try {
    fs.writeFileSync(tmpOrig, original, 'utf-8');
    fs.writeFileSync(tmpPatched, patched, 'utf-8');
    const diffRes = spawnSync('git', ['diff', '--no-color', '--no-index', tmpOrig, tmpPatched], { encoding: 'utf-8' });
    // git diff --no-index sale con 1 cuando hay diferencias (esperado).
    if (diffRes.status !== 0 && diffRes.status !== 1) return undefined;
    let diff = (diffRes.stdout || '').trim();
    if (!diff || !diff.includes('@@')) return undefined;
    // Reescribe las rutas de los temporales en las líneas de cabecera para
    // que el diff referencie el archivo real del repo, y quita la línea
    // `index` (el blob no existe en .git/objects). Solo se tocan las líneas
    // ANTES del primer `@@` — el cuerpo del diff se deja intacto.
    const repoRel = p.file.replace(/\\/g, '/');
    let inHunks = false;
    diff = diff
      .split(/\n/)
      .filter((l) => !/^index [0-9a-f]+\.\.[0-9a-f]+/.test(l))
      .map((l) => {
        if (l.startsWith('@@')) inHunks = true;
        if (inHunks) return l;
        if (l.startsWith('diff --git ')) return `diff --git a/${repoRel} b/${repoRel}`;
        if (l.startsWith('--- ')) return `--- a/${repoRel}`;
        if (l.startsWith('+++ ')) return `+++ b/${repoRel}`;
        return l;
      })
      .join('\n');
    return { diff };
  } catch {
    return undefined;
  } finally {
    try { fs.unlinkSync(tmpOrig); } catch { /* best effort */ }
    try { fs.unlinkSync(tmpPatched); } catch { /* best effort */ }
  }
}

/**
 * F3 — verifica si un diff aplicaria via `git apply --check`.
 * Devuelve 'ok' si aplica strict, 'fuzzy' si solo via --3way, 'broken' si nada.
 */
export function checkProposalApplicability(p: Proposal, cwd = process.cwd()): { applicability: 'ok' | 'fuzzy' | 'broken'; error?: string } {
  const tmp = path.join(os.tmpdir(), `shinobi-check-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.patch`);
  fs.writeFileSync(tmp, p.diff.endsWith('\n') ? p.diff : p.diff + '\n');
  try {
    const strict = spawnSync('git', ['apply', '--check', '--whitespace=nowarn', tmp], { cwd, encoding: 'utf-8' });
    if (strict.status === 0) return { applicability: 'ok' };
    const fuzzy = spawnSync('git', ['apply', '--check', '--3way', '--whitespace=nowarn', tmp], { cwd, encoding: 'utf-8' });
    if (fuzzy.status === 0) return { applicability: 'fuzzy' };
    return { applicability: 'broken', error: ((strict.stderr || strict.stdout) || '').trim().slice(0, 200) };
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

export async function applyProposal(id: string, asker: (q: string) => Promise<string>): Promise<ApplyResult> {
  const jsonPath = findLatestProposalsJson();
  if (!jsonPath) return { ok: false, message: 'no proposals/ found — run /improvements first', proposalId: id };
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const list: Proposal[] = raw.proposals ?? [];
  const p = list.find((x) => x.id === id);
  if (!p) return { ok: false, message: `proposal '${id}' not found in ${path.basename(jsonPath)}`, proposalId: id };

  // F3 — refresh applicability before prompting.
  if (!p.applicability) {
    const r = checkProposalApplicability(p);
    p.applicability = r.applicability;
    p.apply_error = r.error;
  }
  if (p.applicability === 'broken') {
    return { ok: false, message: `proposal marked [BROKEN_DIFF]: ${p.apply_error ?? 'patch does not apply'}. Skipping.`, proposalId: id };
  }

  console.log('');
  console.log(`Proposal: ${p.id} ${applicabilityTag(p)}`);
  console.log(`  file:   ${p.file}`);
  console.log(`  risk:   ${p.risk}`);
  console.log(`  motive: ${p.motive}`);
  console.log('');
  console.log('--- DIFF ---');
  console.log(p.diff);
  console.log('--- END ---');
  if (p.applicability === 'fuzzy') {
    console.log('NOTE: this patch only applies via 3-way merge; review the resulting diff carefully.');
  }
  console.log('');

  const ans = (await asker('Apply this proposal? [y/N]: ')).trim().toLowerCase();
  if (ans !== 'y' && ans !== 'yes' && ans !== 's' && ans !== 'si') {
    return { ok: false, message: 'aborted by user', proposalId: id };
  }

  // F3 — try strict apply first; fall back to --3way (which needs blobs in
  // .git/objects). Strict apply only checks context against working tree,
  // which is enough for diffs reconstructed via `git diff` after a temp write.
  const tmpFile = path.join(os.tmpdir(), `shinobi-apply-${Date.now()}.patch`);
  fs.writeFileSync(tmpFile, p.diff.endsWith('\n') ? p.diff : p.diff + '\n');
  let res = spawnSync('git', ['apply', '--whitespace=nowarn', tmpFile], { cwd: process.cwd(), encoding: 'utf-8' });
  if (res.status !== 0) {
    res = spawnSync('git', ['apply', '--3way', '--whitespace=nowarn', tmpFile], { cwd: process.cwd(), encoding: 'utf-8' });
  }
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
