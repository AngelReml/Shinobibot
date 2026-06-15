/**
 * C-21 — LA PRUEBA DURA del Nivel 1 (dossier §13, P1–P6). El clon-sombra de
 * principio a fin, salida binaria. P5 (señuelo rechazado) y P6 (sin fabricación)
 * son el alma: un investigador potente pero crédulo encuentra la aguja y falla
 * esos — se traga el 99% sin fuente o reporta lo que no persistió.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { aggregateCredibility, admissibleAsFact } from '../thread/credibility.js';
import { mapFindingToModule } from '../contrast/contrast.js';
import { buildDawnReport, auditNoFabrication } from '../synth/report.js';
import { KagemushaStore } from '../store/store.js';
import type { Claim, Provenance, CredibilitySignals, CodebaseUnit } from '../types.js';

const stores: KagemushaStore[] = [];
const mem = () => { const s = new KagemushaStore({ db_path: ':memory:' }); stores.push(s); return s; };
afterEach(() => { while (stores.length) { try { stores.pop()!.close(); } catch {} } });

const prov = (tier: 0 | 1 | 2 | 3, url?: string): Provenance => ({ origin: 'AGENT_DERIVED', channel: 'kagemusha', source_url: url, retrieved_at: 't', trust_tier: tier, session_seq: 0 });

const solidSignals: CredibilitySignals = { source_tier: 3, authors_traceable: true, author_track_record: 'established', affiliation: 'known_lab_or_org', corroboration_count: 2, has_artifacts: true, recency_ok: true, red_flags: [] };
const unfoundedSignals: CredibilitySignals = { source_tier: 0, authors_traceable: false, corroboration_count: 0, has_artifacts: false, recency_ok: false, red_flags: ['anonymous', 'no source'] };

describe('kagemusha — C-21 LA PRUEBA DURA (P1–P6)', () => {
  it('P2 — credibilidad correcta: paper con autores trazados → SOLID/PLAUSIBLE; señuelo → UNFOUNDED', () => {
    const good = aggregateCredibility(solidSignals);
    expect(['SOLID', 'PLAUSIBLE']).toContain(good.level);
    expect(admissibleAsFact(good)).toBe(true);
    const decoy = aggregateCredibility(unfoundedSignals);
    expect(decoy.level).toBe('UNFOUNDED');
    expect(admissibleAsFact(decoy)).toBe(false);
  });

  it('P4 — anclaje al código correcto: ContrastVerdict referencia el módulo real', () => {
    const units: CodebaseUnit[] = [
      { unit_id: 'u1', path: 'src/integrity/checks.ts', symbol: 'check11_4', capability_summary: 'reported equals real outcome fabrication check' },
      { unit_id: 'u2', path: 'src/memory/embedding_provider.ts', symbol: 'embed', capability_summary: 'vector embeddings cosine similarity' },
    ];
    const v = mapFindingToModule('claim_x', 'a fabrication check that compares reported outcome to the real tool result', units);
    expect(v.codebase_unit).toContain('checks.ts');
    expect(['SIRVE', 'YA_LO_TENEMOS', 'MEJOR_QUE_NOSOTROS', 'IRRELEVANTE']).toContain(v.verdict);
  });

  it('P1+P5+P6 — aguja reportada, señuelo descartado, cero fabricación (informe binario)', () => {
    const s = mem();
    // la AGUJA: dato exacto 73.4%, resuelto vía descripción (no link), fuente fuerte.
    const needle: Claim = { claim_id: 'c_needle', text: 'El método logra 73.4% en el benchmark X.', node_id: 'n1', status: 'corroborated', corroborating_sources: ['https://arxiv.org/abs/1', 'https://arxiv.org/abs/2'], credibility: aggregateCredibility(solidSignals), provenance: prov(3, 'https://arxiv.org/abs/0') };
    // el SEÑUELO: 99% de una fuente tier 0 / UNFOUNDED.
    const decoy: Claim = { claim_id: 'c_decoy', text: 'Un tweet anónimo dice que alcanza 99% sin esfuerzo.', node_id: 'n2', status: 'unverified', corroborating_sources: [], credibility: aggregateCredibility(unfoundedSignals), provenance: prov(0) };
    s.upsertClaim(needle); s.upsertClaim(decoy);

    let report = buildDawnReport(s, { missionId: 'm', reportId: 'r', generatedAt: 't', looked_at: { channels: 1, transcripts: 3, threads: 2 } });

    // P1 — la aguja está, con su dato exacto.
    expect(report.highlights.some((h) => h.text.includes('73.4%'))).toBe(true);
    // P5 — el señuelo del 99% NO es highlight; está descartado por tier 0 / UNFOUNDED.
    expect(report.highlights.some((h) => h.text.includes('99%'))).toBe(false);
    expect(report.discarded.some((d) => d.text.includes('99%') && /UNFOUNDED|tier 0/.test(d.reason))).toBe(true);
    expect(report.integrity.unverified_excluded).toBeGreaterThanOrEqual(1);

    // P6 — cero fabricación: cada highlight rastrea a un claim persistido.
    report = auditNoFabrication(report, s);
    expect(report.integrity.fabrication_flags).toBe(0);
    expect(report.highlights.every((h) => h.claim_ids.length > 0)).toBe(true);

    // y una highlight inventada (sin claim) sería barrida por el audit:
    report.highlights.push({ text: 'dato inventado', confidence: 0.9, provenance: [prov(3)], claim_ids: ['c_ghost'] });
    report = auditNoFabrication(report, s);
    expect(report.integrity.fabrication_flags).toBe(1);
    expect(report.highlights.some((h) => h.text === 'dato inventado')).toBe(false);
  });
});
