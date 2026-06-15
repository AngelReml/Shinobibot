/**
 * C-22 — EL PROMPT WOW (§14) scaffold: "investiga de noche y dame el Informe del
 * Amanecer". Puntas vivas (descarga + ANALYZE) faked; el operador las cambia por reales.
 */
import { describe, it, expect } from 'vitest';
import { runDawnDemo, type TranscriptFetcher } from '../demo.js';
import type { Transcript, Provenance, CredibilitySignals } from '../types.js';

const prov = (tier: 0 | 1 | 2 | 3): Provenance => ({ origin: 'USER_DIRECT', channel: 'youtube_transcript', retrieved_at: 't', trust_tier: tier, session_seq: 0 });
const tx = (id: string, text: string, tier: 0 | 1 | 2 | 3 = 2): Transcript =>
  ({ transcript_id: id, video_id: id, channel_id: 'c', title: id, lang: 'es', text, token_count: text.length, provenance: prov(tier), ingested_at: 't' });

const solid: CredibilitySignals = { source_tier: 3, authors_traceable: true, author_track_record: 'established', affiliation: 'known_lab_or_org', corroboration_count: 2, has_artifacts: true, recency_ok: true, red_flags: [] };
const unfounded: CredibilitySignals = { source_tier: 0, authors_traceable: false, corroboration_count: 0, has_artifacts: false, recency_ok: false, red_flags: ['anon'] };

describe('kagemusha — C-22 PROMPT WOW (Informe del Amanecer)', () => {
  it('produce el informe con highlight creíble, señuelo descartado y cero fabricación', async () => {
    const fetch: TranscriptFetcher = async () => [
      tx('t1', 'El método logra 73.4% en el benchmark. Funciona y supera a la baseline.'),
      tx('t2', 'Un anónimo dice 99% sin pruebas.', 0),
    ];
    const claimsFrom = (t: Transcript) => t.transcript_id === 't1'
      ? [{ text: 'logra 73.4% en el benchmark', signals: solid }]
      : [{ text: 'alcanza 99% sin pruebas', signals: unfounded }];

    const { report, narration } = await runDawnDemo(fetch, claimsFrom);
    expect(report.highlights.some((h) => h.text.includes('73.4%'))).toBe(true);
    expect(report.highlights.some((h) => h.text.includes('99%'))).toBe(false);
    expect(report.integrity.fabrication_flags).toBe(0);
    expect(report.integrity.unverified_excluded).toBeGreaterThanOrEqual(1);
    expect(narration).toMatch(/INFORME DEL AMANECER/);
    expect(narration).toMatch(/DESCARTÉ/);
  });
});
