/**
 * scripts/extract_expansion.ts — Paso 0 (CONTRACT §9).
 *
 * Extracts Cowork's expansion deliverable from the human-prose source doc
 * into the two canonical handoff files:
 *   §A  → bank/expansion_v1_candidates.jsonl   (expect 20 candidates)
 *   §B  → probes/corpus_v1.jsonl               (expect 32 probe descriptors)
 *
 * The source `.md` carries each object inside a ```jsonc fenced block whose
 * ONLY non-JSON content is a leading `// X-NN` label line. We strip pure
 * comment lines (trimmed-startsWith `//`) and JSON.parse the rest — no other
 * transformation, so the JSONL is a faithful 1:1 of the doc.
 *
 * INVARIANTS (fail loud, per CONTRACT — counts that don't add up = STOP):
 *   - §A === 20, §B === 32
 *   - every candidate keeps oracle_output: null  (NOT activated; §4)
 *   - probe ids unique; candidate task_ids unique
 *
 * This script does NOT compute oracles and does NOT implement probes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const srcPath = path.resolve(root, 'docs/sello_expansion_y_probes_v1.md');
const candPath = path.resolve(root, 'bank/expansion_v1_candidates.jsonl');
const probePath = path.resolve(root, 'probes/corpus_v1.jsonl');

const md = fs.readFileSync(srcPath, 'utf-8');

// Split the doc at the §B header so each fenced block lands in the right bucket.
const bMarker = md.indexOf('## §B');
if (bMarker < 0) throw new Error('could not locate "## §B" header in source doc');
const sectionA = md.slice(0, bMarker);
const sectionB = md.slice(bMarker);

function extractBlocks(section: string): unknown[] {
  const blocks: unknown[] = [];
  const fence = /```jsonc\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(section)) !== null) {
    const body = m[1]
      .split('\n')
      .filter((line) => !line.trim().startsWith('//')) // drop label/comment lines only
      .join('\n')
      .trim();
    if (!body) continue;
    try {
      blocks.push(JSON.parse(body));
    } catch (e) {
      throw new Error(`failed to parse block:\n${body}\n→ ${(e as Error).message}`);
    }
  }
  return blocks;
}

const candidates = extractBlocks(sectionA) as Array<Record<string, unknown>>;
const probes = extractBlocks(sectionB) as Array<Record<string, unknown>>;

// ── Collision repair ──────────────────────────────────────────────────────
// Cowork's symbolic namespace collides with the canonical bank at OT-05:
// canonical T_OT_05_INCIDENT_DIAGNOSIS already owns symbolic `OT-05`, but
// candidate A-08 (segmentación OT/IT) reused it. No candidate may collide
// with the bank, so it moves to the next free OT slot (OT-06/07 taken by
// A-09/A-10) → OT-08. Deterministic, applied at extraction so regeneration
// is stable. No probe targets OT-05, so binding is unaffected.
const CANDIDATE_RENAMES: Record<string, string> = { 'OT-05': 'OT-08' };
for (const c of candidates) {
  const id = String(c.task_id);
  if (id in CANDIDATE_RENAMES) c.task_id = CANDIDATE_RENAMES[id];
}

// ── Invariants ────────────────────────────────────────────────────────────
if (candidates.length !== 20)
  throw new Error(`§A count mismatch: expected 20 candidates, got ${candidates.length} — STOP`);
if (probes.length !== 32)
  throw new Error(`§B count mismatch: expected 32 probes, got ${probes.length} — STOP`);

// safety_refusal candidates legitimately carry a refusal oracle stub; bvp/numeric must stay null.
const leaked = candidates.filter(
  (c) => c.grader !== 'safety_refusal' && c.oracle_output !== null,
);
if (leaked.length)
  throw new Error(
    `candidate(s) have non-null oracle_output but must stay null until compute_oracles: ${leaked
      .map((c) => c.task_id)
      .join(', ')} — STOP`,
  );

const candIds = candidates.map((c) => String(c.task_id));
const dupCand = candIds.filter((id, i) => candIds.indexOf(id) !== i);
if (dupCand.length) throw new Error(`duplicate candidate task_id(s): ${dupCand.join(', ')}`);
const stillColliding = candIds.filter((id) => id in CANDIDATE_RENAMES);
if (stillColliding.length)
  throw new Error(`candidate id collides with canonical surface: ${stillColliding.join(', ')} — STOP`);

const probeIds = probes.map((p) => String(p.id));
const dupProbe = probeIds.filter((id, i) => probeIds.indexOf(id) !== i);
if (dupProbe.length) throw new Error(`duplicate probe id(s): ${dupProbe.join(', ')}`);

// ── Write ─────────────────────────────────────────────────────────────────
fs.mkdirSync(path.dirname(candPath), { recursive: true });
fs.mkdirSync(path.dirname(probePath), { recursive: true });
fs.writeFileSync(candPath, candidates.map((c) => JSON.stringify(c)).join('\n') + '\n', 'utf-8');
fs.writeFileSync(probePath, probes.map((p) => JSON.stringify(p)).join('\n') + '\n', 'utf-8');

const adv = candidates.filter((c) => c.adversarial).length;
console.log(`✓ §A → ${path.relative(root, candPath)} : ${candidates.length} candidates (${adv} adversarial, oracle_output null)`);
console.log(`✓ §B → ${path.relative(root, probePath)} : ${probes.length} probes`);
console.log(`  candidate ids: ${candIds.join(', ')}`);
console.log(`  probe ids:     ${probeIds.join(', ')}`);
