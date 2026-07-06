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
 *
 * F5 (2026-07-06, remate P5-Nivel 1) — los puntos 3 y 4 de arriba quedaron
 * COMPLETADOS, se conservan como historia:
 *   - Las costuras vivas existen en live/deps.ts (egress SOLO vía tools
 *     autorizadas + subproceso yt-dlp patrón SEC-F4.2); siguen siendo opt-in:
 *     este fichero no las importa, las inyecta quien invoca (el tool wrapper).
 *   - La tool `run_kagemusha` está registrada (src/tools/kagemusha_run.ts,
 *     import en el barrel src/tools/index.ts).
 *   - El handler THREAD usa la Frontier REAL (§8.6): priority queue, poda,
 *     expansión de citas con anti-ciclo → P3 (segundo hilo) cubierto.
 *   - Los claims reales llevan credibilidad (rúbrica §8.5 sobre señales
 *     medidas), los verdicts de contraste llegan al informe (fix), y el
 *     informe se escribe SIEMPRE a reports/<mission_id>.md (C-18).
 *   - maxWallClockMs se enforcea en mission.ts (antes era decorativo).
 * El scheduler nocturno SIGUE fuera A PROPÓSITO: la decisión de producto
 * (ventana, fuentes, techo de gasto) continúa pendiente y es del operador.
 */

import { kagemushaEnabled } from './config.js';
import { KagemushaStore, sharedKagemushaStore } from './store/store.js';
import { runMission, type PhaseHandlers, type MissionResult } from './mission/mission.js';
import { downloadChannelTranscripts, importToCorpus } from './ingest/transcripts.js';
import { orchestrateAnalysis } from './analysis/orchestrate.js';
import { canonical, Frontier, shouldExpand, adjustPriorScore } from './thread/frontier.js';
import { resolveReference, tierForUrl, type ResolveDeps } from './thread/resolve.js';
import { acquireNode, type Fetcher } from './thread/acquire.js';
import { analyzeNode, type NodeAnalysis } from './thread/node_analyze.js';
import { aggregateCredibility } from './thread/credibility.js';
import { buildCodebaseIndex, type IndexInput } from './contrast/codebase_index.js';
import { mapFindingToModule, mapFindingToModuleAsync, type ContrastJudge, type AsyncContrastJudge } from './contrast/contrast.js';
import { buildDawnReport, auditNoFabrication } from './synth/report.js';
import { renderMarkdown, FileSink } from './synth/render.js';
import type { DawnReport, MissionSpec, Entity, ResearchNode, ContrastVerdict, CredibilitySignals, TrustTier } from './types.js';
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
  /** F5 — juez de contraste async (LLM vía kageLLM). Prioridad sobre contrastJudge. */
  asyncContrastJudge?: AsyncContrastJudge;
  /** F5 — carpeta del sink de informes. Default: <dir de kagemusha.db>/reports. */
  reportsDir?: string;
  /** F5 — reloj inyectable para el presupuesto maxWallClockMs (tests deterministas). */
  now?: () => number;
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
export type RunKagemushaResult = MissionResult & { reportPath?: string };

export async function runKagemusha(opts: RunKagemushaOptions): Promise<RunKagemushaResult> {
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
  const result = await runMission(spec, store, handlers, { missionId, ts, now: opts.now });

  // F5 — C-18: el informe se escribe SIEMPRE a fichero (dossier §10.3), además
  // de persistirse en el store. Default: reports/ junto a kagemusha.db.
  let reportPath: string | undefined;
  if (result.report) {
    const dir = opts.reportsDir ?? path.join(path.dirname(store.dbPath), 'reports');
    await new FileSink(dir).deliver(result.report, renderMarkdown(result.report));
    reportPath = path.join(dir, `${result.report.mission_id}.md`);
  }
  return { ...result, reportPath };
}

/**
 * F5 — señales de credibilidad MEDIDAS del nodo adquirido (dossier §8.5: las
 * señales se rellenan por extracción, la rúbrica determinista decide; ningún
 * LLM dicta el veredicto). `corroboration_count` arranca en 0 SIEMPRE — la
 * corroboración exige fuentes independientes en una fase posterior, no se asume.
 */
export function signalsFromAnalysis(node: ResearchNode, analysis: NodeAnalysis, content: string): CredibilitySignals {
  return {
    source_tier: node.provenance.trust_tier,
    authors_traceable: analysis.authors.length > 0,
    corroboration_count: 0,
    has_artifacts: /github\.com|gitlab\.com|huggingface\.co|zenodo\.org/i.test(content),
    recency_ok: true,
    red_flags: [],
  };
}

/**
 * Wire the state machine's PhaseHandlers to the real (non-stub) subsystems.
 * F5: exportada para que los tests compongan misiones con seams falsos sin red,
 * y THREAD ahora es la frontera REAL del §8.6 (priority queue + poda + expansión
 * con anti-ciclo), no un índice lineal a profundidad 1.
 */
export function buildRealHandlers(store: KagemushaStore, opts: RunKagemushaOptions): PhaseHandlers {
  let frontier = new Frontier();
  let frontierReady = false;
  const contrasts: ContrastVerdict[] = [];
  const ARXIV_CITE_RE = /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/i;

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

    async analyze(state) {
      const all = store.listTranscripts();
      const { findings, entities } = orchestrateAnalysis(all);
      for (const f of findings) store.upsertFinding(f);
      for (const e of entities) store.upsertEntity(e);
      // Siembra de la frontera (§7.3): las entidades entran ordenadas por score.
      frontier = new Frontier(entities.map((e) => ({ candidate: e, parentDepth: 0, priorScore: e.relevance_score })));
      frontierReady = true;
      state.frontier = frontier.snapshot();
      return { seeds: entities.length, tokens: 0 };
    },

    async thread(state) {
      // Reanudación: si ANALYZE no corrió en esta invocación, rehidratar la
      // frontera persistida (§8.7 — el grafo retoma donde quedó).
      if (!frontierReady) { frontier = new Frontier(state.frontier ?? []); frontierReady = true; }

      const more = () => frontier.size > 0;
      const sync = () => { state.frontier = frontier.snapshot(); };

      const item = frontier.pop();
      if (!item) { sync(); return { moreSeeds: false, investigated: 0, tokens: 0 }; }

      const seed = item.candidate;
      const key = canonical(seed);
      if (state.visited.includes(key)) { sync(); return { moreSeeds: more(), investigated: 0, tokens: 0 }; }
      if (!shouldExpand(item, state.spec.budget, state)) {
        // Poda por diseño (§8.6): profundidad/relevancia/presupuesto. No es un hueco.
        sync(); return { moreSeeds: more(), investigated: 0, tokens: 0 };
      }
      state.visited.push(key);
      const depth = item.parentDepth + 1;

      // RESOLVE — un candidato derivado (cita con URL propia) va directo; una
      // semilla del corpus pasa por la cascada §8.2 con los resolvers inyectados.
      let url: string | undefined;
      let tier: TrustTier = seed.provenance.trust_tier;
      let via = 'direct_source_url';
      if (seed.provenance.source_url) {
        url = seed.provenance.source_url;
        tier = tierForUrl(url);
      } else {
        const transcript = store.listTranscripts().find((t) => seed.raw_mentions.some((m) => m.transcript_id === t.transcript_id));
        if (transcript) {
          const resolved = await resolveReference(seed, { transcript }, opts.resolveDeps ?? {});
          if (resolved?.url) { url = resolved.url; tier = resolved.tier; via = resolved.via; }
        }
      }
      if (!url) {
        state.gaps.push(`sin fuente resuelta para "${seed.name}"${opts.resolveDeps ? ' (cascada §8.2 agotada)' : ' (sin resolvers vivos inyectados)'}`);
        sync(); return { moreSeeds: more(), investigated: 0, tokens: 0 };
      }
      if (!opts.fetcher) {
        state.gaps.push(`fuente localizada para "${seed.name}" (${url}, via ${via}) pero sin fetcher inyectado — no adquirida`);
        sync(); return { moreSeeds: more(), investigated: 0, tokens: 0 };
      }

      // ACQUIRE + ANALYZE + CREDIBILITY (rúbrica determinista sobre señales medidas).
      const node: ResearchNode = {
        node_id: `node_${key}`, entity_id: seed.entity_id,
        kind: seed.kind === 'paper' ? 'paper' : seed.kind === 'repo' ? 'repo' : 'concept',
        label: seed.name, acquired: false, source_url: url, depth,
        provenance: { ...seed.provenance, source_url: url, trust_tier: tier },
      };
      const acq = await acquireNode(node, opts.fetcher, new Date().toISOString());
      if (!acq.content) {
        store.upsertNode(acq.node);
        state.gaps.push(`no se pudo adquirir "${seed.name}" (${url})`);
        sync(); return { moreSeeds: more(), investigated: 0, tokens: 0 };
      }
      store.putContent(acq.content.ref, acq.content.text, new Date().toISOString());
      const analysis = analyzeNode(acq.node, acq.content.text);
      const credibility = aggregateCredibility(signalsFromAnalysis(acq.node, analysis, acq.content.text));
      const investigatedNode: ResearchNode = { ...acq.node, credibility };
      store.upsertNode(investigatedNode);
      for (const c of analysis.claims) store.upsertClaim({ ...c, credibility });
      if (item.parentNodeId) store.addEdge({ from: item.parentNodeId, to: investigatedNode.node_id, relation: 'cites' });

      // EXPAND (§8.6) — P3: las citas arxiv del contenido entran a la frontera
      // como candidatos hijos con prior ajustado. "[12]" no es resoluble solo.
      for (const cite of analysis.citations) {
        const m = cite.match(ARXIV_CITE_RE);
        if (!m) continue;
        const citeUrl = `https://arxiv.org/abs/${m[1]}`;
        const child: Entity = {
          entity_id: `ent_cite_${m[1]}`, kind: 'paper', name: `arxiv:${m[1]}`,
          raw_mentions: [], first_seen_at: new Date().toISOString(),
          relevance_score: item.priorScore,
          provenance: { origin: 'AGENT_DERIVED', channel: 'arxiv', source_url: citeUrl, retrieved_at: '', trust_tier: 2, session_seq: 0 },
        };
        if (state.visited.includes(canonical(child))) continue;   // anti-ciclo
        frontier.push({
          candidate: child, parentDepth: depth,
          priorScore: adjustPriorScore(item.priorScore, { citedBySolid: credibility.level === 'SOLID', depth }),
          parentNodeId: investigatedNode.node_id,
        });
      }

      sync();
      return { moreSeeds: more(), investigated: 1, tokens: 0 };
    },

    async contrast() {
      if (!opts.repoRoot) return { tokens: 0 };
      const files = collectSourceFiles(opts.repoRoot);
      const units = buildCodebaseIndex(files);
      for (const u of units) store.upsertCodebaseUnit(u);
      for (const c of store.listClaims()) {
        const verdict: ContrastVerdict = opts.asyncContrastJudge
          ? await mapFindingToModuleAsync(c.claim_id, c.text, units, { judge: opts.asyncContrastJudge })
          : mapFindingToModule(c.claim_id, c.text, units, { judge: opts.contrastJudge });
        store.addContrast(verdict);
        contrasts.push(verdict);
      }
      return { tokens: 0 };
    },

    async synthesize(state, looked_at, gaps) {
      // F5 fix: los verdicts de contraste AHORA llegan al informe (antes se
      // guardaban en el store pero buildDawnReport nunca los recibía —
      // highlights sin `contrast` y build_suggestions siempre vacías).
      let report: DawnReport = buildDawnReport(store, {
        missionId: state.mission_id, reportId: `dawn_${state.mission_id}`,
        generatedAt: state.updatedAt, looked_at, gaps, contrasts,
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
