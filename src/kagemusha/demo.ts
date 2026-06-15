/**
 * kagemusha/demo.ts — C-22: scaffold del PROMPT WOW (§14). "Investiga de noche mis
 * canales y dame el Informe del Amanecer." Corre el ciclo nocturno de punta a punta
 * sobre el corpus, con las puntas vivas (descarga de transcripts) INYECTADAS — el
 * operador solo cambia `fetchTranscripts` por la descarga real (yt-dlp + red). Lo que
 * demuestra: análisis → entidades → credibilidad → informe con procedencia y CERO
 * fabricación, todo determinista y reproducible.
 */

import { orchestrateAnalysis } from './analysis/orchestrate.js';
import { aggregateCredibility, admissibleAsFact } from './thread/credibility.js';
import { buildDawnReport, auditNoFabrication } from './synth/report.js';
import { KagemushaStore } from './store/store.js';
import type { Transcript, Claim, CredibilitySignals, DawnReport } from './types.js';

/** ⚑ LIVE seam: fetch the night's transcripts (yt-dlp + network). Injected/faked. */
export type TranscriptFetcher = () => Promise<Transcript[]>;

export interface DawnDemoResult { report: DawnReport; narration: string; }

/**
 * Run the nightly cycle on an in-memory store. `claimsFrom` maps a transcript to the
 * atomic claims it yields with their credibility signals (the LLM ANALYZE seam,
 * injected); by default it derives nothing (the demo focuses on the honest pipeline).
 */
export async function runDawnDemo(
  fetchTranscripts: TranscriptFetcher,
  claimsFrom: (t: Transcript) => { text: string; signals: CredibilitySignals }[],
  ts = 't',
): Promise<DawnDemoResult> {
  const store = new KagemushaStore({ db_path: ':memory:' });
  try {
    const transcripts = await fetchTranscripts();
    const { findings, entities } = orchestrateAnalysis(transcripts);

    let seq = 0;
    for (const t of transcripts) {
      for (const c of claimsFrom(t)) {
        const cred = aggregateCredibility(c.signals);
        const claim: Claim = {
          claim_id: `c${++seq}`, text: c.text, node_id: t.transcript_id,
          status: admissibleAsFact(cred) ? 'corroborated' : 'unverified',
          corroborating_sources: [], credibility: cred, provenance: { ...t.provenance, origin: 'AGENT_DERIVED' },
        };
        store.upsertClaim(claim);
      }
    }

    let report = buildDawnReport(store, { missionId: 'demo', reportId: 'dawn', generatedAt: ts, looked_at: { channels: 1, transcripts: transcripts.length, threads: entities.length } });
    report = auditNoFabrication(report, store);

    const N = ['🌅 INFORME DEL AMANECER (demo):'];
    N.push(`MIRÉ: ${report.looked_at.transcripts} transcripts, ${report.looked_at.threads} hilos, ${findings.length} hallazgos.`);
    N.push(`VALE (${report.highlights.length}):`);
    for (const h of report.highlights) N.push(`  • ${h.text} [conf ${h.confidence.toFixed(2)}, tier ${h.provenance[0]?.trust_tier}]`);
    N.push(`DESCARTÉ (${report.discarded.length}):`);
    for (const d of report.discarded) N.push(`  • ${d.text} — ${d.reason}`);
    N.push(`INTEGRIDAD: ${report.integrity.fabrication_flags} fabricaciones, ${report.integrity.unverified_excluded} no-verificadas excluidas.`);

    return { report, narration: N.join('\n') };
  } finally {
    store.close();
  }
}
