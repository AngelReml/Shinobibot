/**
 * kagemusha/trigger.ts — F4.1 (2026-07-01): the explicit, operator-invokable
 * entrypoint that was missing. Before this file, kagemushaEnabled() existed
 * but NOTHING in the runtime ever called it — no cron, no tool, no
 * slash-command. "Investigar de noche" never happened automatically or on
 * demand; the whole Level-1 subsystem was dead code from the orchestrator's
 * point of view.
 *
 * PRODUCT DECISION (documented here, see also DECISIONES.md):
 * A real cron/scheduler that fires unattended every night — reading the
 * user's YouTube subscriptions, fetching external web pages during THREAD,
 * and running LLM calls with no human in the loop — is a meaningfully larger
 * decision than "wire the existing state machine": it commits Shinobi to
 * unattended nightly network egress and LLM spend, and needs its own product
 * call about scheduling windows, source lists, and cost caps that nobody has
 * made yet. That is out of scope for a surgical remediation pass and belongs
 * to whoever owns src/tools/task_scheduler_create.ts + the product roadmap.
 *
 * What THIS file does instead — the safe, minimum-viable option the plan
 * explicitly prefers: an explicit, operator-invoked trigger, `runKagemusha()`,
 * that:
 *   1. Refuses to run at all unless kagemushaEnabled() is true (respects the
 *      existing gate — this was the one thing already built and never
 *      consulted).
 *   2. Wires the REAL subsystems (ingest → analyze → thread → contrast →
 *      synthesize) through the existing mission state machine
 *      (mission/mission.ts), not a new loop.
 *   3. Keeps network egress during THREAD an explicit opt-in: unless the
 *      caller injects a `fetcher`, no web fetch happens and threads resolve
 *      with an honest gap ("sin fetcher inyectado") rather than silently
 *      doing nothing or fabricating content. This mirrors the module's own
 *      existing ⚑ LIVE-seam design (Fetcher is already an injected
 *      dependency in thread/acquire.ts) and the repo's general policy that
 *      network egress is opt-in and auditable.
 *   4. Is exported as a plain async function, not registered as a Tool —
 *      src/tools/index.ts (the barrel that activates registerTool() calls)
 *      is OUT OF THIS TRACK'S SCOPE (a different remediation track owns
 *      src/tools/). Registering this as a callable `run_kagemusha` tool is a
 *      ONE-LINE follow-up for whoever owns that barrel:
 *        import './kagemusha_run.js';      // new thin Tool wrapper, or
 *        registerTool(makeRunKagemushaTool());  // calling the export below
 *      This file provides everything needed for that one-liner; it does not
 *      itself touch src/tools/.
 */

import { kagemushaEnabled } from './config.js';
import { KagemushaStore, sharedKagemushaStore } from './store/store.js';
import { runMission, type PhaseHandlers, type MissionResult } from './mission/mission.js';
import { downloadChannelTranscripts, importToCorpus } from './ingest/transcripts.js';
import { orchestrateAnalysis } from './analysis/orchestrate.js';
import { canonical } from './thread/frontier.js';
import { resolveReference, type ResolveDeps } from './thread/resolve.js';
import { acquireNode, type Fetcher } from './thread/acquire.js';
import { analyzeNode } from './thread/node_analyze.js';
import { buildCodebaseIndex, type IndexInput } from './contrast/codebase_index.js';
import { mapFindingToModule, type ContrastJudge } from './contrast/contrast.js';
import { buildDawnReport, auditNoFabrication } from './synth/report.js';
import type { DawnReport, MissionSpec, Entity, ResearchNode, ContrastVerdict } from './types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Walk repoRoot's *.ts files (skipping node_modules/dist/.git) into IndexInput[]
 *  for buildCodebaseIndex. Bounded to a sane file count so CONTRAST can't hang
 *  a manual invocation on a huge repo. */
function collectSourceFiles(repoRoot: string, maxFiles = 400): IndexInput[] {
  const out: IndexInput[] = [];
  const SKIP = new Set(['node_modules', 'dist', '.git', 'missions', 'coverage']);
  const walk = (dir: string) => {
    if (out.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (out.length >= maxFiles) return;
      if (SKIP.has(ent.name)) continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (/\.ts$/.test(ent.name) && !ent.name.endsWith('.test.ts')) {
        try {
          out.push({ path: path.relative(repoRoot, abs), content: fs.readFileSync(abs, 'utf-8') });
        } catch { /* unreadable file — skip, not fatal */ }
      }
    }
  };
  walk(repoRoot);
  return out;
}

export class KagemushaDisabledError extends Error {
  constructor() {
    super('Kagemusha está desactivado (KAGEMUSHA_ENABLED no es 1/true/on). runKagemusha() se niega a correr — el gate existe para ser respetado, no ignorado.');
    this.name = 'KagemushaDisabledError';
  }
}

export interface RunKagemushaOptions {
  /** Channels to ingest this run (handles/URLs — validated by assertValidChannel). */
  channels: string[];
  langs?: string[];
  maxTranscriptsPerChannel?: number;
  /** Where to write downloaded subtitle files before import. */
  outDir: string;
  /** Absolute path to the repo root, for the CONTRAST phase's self-index. Optional — omit to skip contrast. */
  repoRoot?: string;
  /** Budget knobs — sane, small defaults so a manual invocation can't run away. */
  budget?: Partial<MissionSpec['budget']>;
  /** F4.1 §3 — network egress during THREAD is opt-in. Omit to keep THREAD
   *  fully offline (resolves nothing, records an honest gap per candidate). */
  fetcher?: Fetcher;
  resolveDeps?: ResolveDeps;
  contrastJudge?: ContrastJudge;
  store?: KagemushaStore;
  missionId?: string;
  ts?: string;
}

const DEFAULT_BUDGET: MissionSpec['budget'] = {
  maxDepth: 2, maxThreads: 10, maxTokens: 50_000, maxWallClockMs: 30 * 60_000, minRelevance: 0.3,
};

/**
 * F4.1 — the operator-invocable trigger. Throws KagemushaDisabledError
 * immediately (before any I/O) if the feature flag is off. This is the ONLY
 * new runtime path that consults kagemushaEnabled() — everything else in
 * kagemusha/ is a library the orchestrator was never wired to call.
 */
export async function runKagemusha(opts: RunKagemushaOptions): Promise<MissionResult> {
  if (!kagemushaEnabled()) throw new KagemushaDisabledError();

  const store = opts.store ?? sharedKagemushaStore();
  const missionId = opts.missionId ?? `night_${Date.now()}`;
  const ts = opts.ts ?? new Date().toISOString();
  const budget: MissionSpec['budget'] = { ...DEFAULT_BUDGET, ...opts.budget };

  const spec: MissionSpec = {
    channels: opts.channels,
    langs: opts.langs,
    maxTranscriptsPerChannel: opts.maxTranscriptsPerChannel,
    budget,
    models: { bulk: 'glm-4-flash', judge: '' },
  };

  const handlers = buildRealHandlers(store, opts);
  return runMission(spec, store, handlers, { missionId, ts });
}

/** Wire the state machine's PhaseHandlers to the real (non-stub) subsystems. */
function buildRealHandlers(store: KagemushaStore, opts: RunKagemushaOptions): PhaseHandlers {
  let currentEntities: Entity[] = [];
  let frontierIdx = 0;

  return {
    async ingest(spec) {
      let channels = 0, transcripts = 0;
      for (const ch of spec.channels) {
        const dl = await downloadChannelTranscripts({
          channel: ch, langs: spec.langs, max: spec.maxTranscriptsPerChannel, outDir: opts.outDir,
        });
        if (!dl.ranSuccessfully) continue; // honest: this channel yielded nothing, not fabricated
        const { imported } = await importToCorpus(dl.files, { channel_id: ch, title: ch }, store);
        channels++;
        transcripts += imported;
      }
      return { transcripts, channels, tokens: 0 };
    },

    async analyze() {
      const all = store.listTranscripts();
      const { findings, entities } = orchestrateAnalysis(all);
      for (const f of findings) store.upsertFinding(f);
      for (const e of entities) store.upsertEntity(e);
      currentEntities = entities;
      frontierIdx = 0;
      return { seeds: entities.length, tokens: 0 };
    },

    async thread(state) {
      if (frontierIdx >= currentEntities.length) return { moreSeeds: false, investigated: 0, tokens: 0 };
      const seed = currentEntities[frontierIdx++];
      const key = canonical(seed);
      if (state.visited.includes(key)) return { moreSeeds: frontierIdx < currentEntities.length, investigated: 0, tokens: 0 };
      state.visited.push(key);

      // RESOLVE — find a source. Without opts.resolveDeps/fetcher this
      // legitimately finds nothing beyond in-transcript links (honest gap,
      // not a fabricated result) — see class doc §3.
      const transcript = store.listTranscripts().find((t) => seed.raw_mentions.some((m) => m.transcript_id === t.transcript_id));
      let investigated = 0;
      if (transcript) {
        const resolved = await resolveReference(seed, { transcript }, opts.resolveDeps ?? {});
        if (resolved?.url && opts.fetcher) {
          const node: ResearchNode = {
            node_id: `node_${key}`, entity_id: seed.entity_id, kind: seed.kind === 'paper' ? 'paper' : 'concept',
            label: seed.name, acquired: false, source_url: resolved.url, depth: 1,
            provenance: { ...seed.provenance, trust_tier: resolved.tier },
          };
          const acq = await acquireNode(node, opts.fetcher, new Date().toISOString());
          store.upsertNode(acq.node);
          if (acq.content) {
            store.putContent(acq.content.ref, acq.content.text, new Date().toISOString());
            const analysis = analyzeNode(acq.node, acq.content.text);
            for (const c of analysis.claims) store.upsertClaim(c);
            investigated = 1;
          }
        } else {
          state.gaps.push(`sin fuente resuelta para "${seed.name}" (sin fetcher inyectado o sin referencia encontrada)`);
        }
      }
      return { moreSeeds: frontierIdx < currentEntities.length, investigated, tokens: 0 };
    },

    async contrast() {
      if (!opts.repoRoot) return { tokens: 0 };
      const files = collectSourceFiles(opts.repoRoot);
      const units = buildCodebaseIndex(files);
      for (const u of units) store.upsertCodebaseUnit(u);
      const findings = store.listClaims();
      for (const c of findings) {
        const verdict: ContrastVerdict = mapFindingToModule(c.claim_id, c.text, units, { judge: opts.contrastJudge });
        store.addContrast(verdict);
      }
      return { tokens: 0 };
    },

    async synthesize(state, looked_at, gaps) {
      let report: DawnReport = buildDawnReport(store, {
        missionId: state.mission_id, reportId: `dawn_${state.mission_id}`,
        generatedAt: state.updatedAt, looked_at, gaps,
      });
      report = auditNoFabrication(report, store);
      return report;
    },
  };
}

/**
 * F4.1 — thin descriptor a Tool-owning track can wrap in one file to expose
 * this as `run_kagemusha`. Not a Tool itself (this module must not import
 * src/tools/tool_registry.js — out of scope), just the shape a wrapper needs.
 */
export interface RunKagemushaToolShape {
  name: 'run_kagemusha';
  description: string;
  gatedBy: typeof kagemushaEnabled;
  run: typeof runKagemusha;
}

export const runKagemushaToolDescriptor: RunKagemushaToolShape = {
  name: 'run_kagemusha',
  description: 'Run one Kagemusha night-research mission now (ingest channels → analyze → thread → contrast → synthesize Dawn Report). No-ops with KagemushaDisabledError unless KAGEMUSHA_ENABLED is set.',
  gatedBy: kagemushaEnabled,
  run: runKagemusha,
};
