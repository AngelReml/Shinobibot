/**
 * Tests E7 — VERIFICABILIDAD (benchmark de autonomía demostrable)
 *
 * Cubre:
 *   1. Carta fundacional — signCharter / verifyCharter / tamper detection
 *   2. Skill-priors adjustment — circuito Sello→PatternBook
 *   3. Benchmark de verificabilidad E7 — métricas para G5 F4.1
 *      (verificación 100%, detección de tamper 100%)
 */

import { describe, it, expect } from 'vitest';
import {
  generateCharterKeypair, buildCharterBody, signCharter, verifyCharter,
  CORE_INVARIANTS_V1,
} from '../charter.js';
import { adjustPrior, adjustPriors, estimateCertPrior } from '../../shugyo/priors.js';
import { PatternBook } from '../../shugyo/curve/patternbook.js';
import {
  generateProvenanceKeypair, buildSignedProvenance, verifySignedProvenance,
} from '../provenance_v2.js';
import type { CertResult } from '../../shugyo/synth/certify.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function certResult(status: 'certified' | 'discarded'): CertResult {
  return {
    status,
    grade: 'strong',
    reason: status === 'discarded' ? 'no pasó oracle' : undefined,
    cases: [{ case_id: 'c1', output_ok: status === 'certified', effects_ok: true, passed: status === 'certified', detail: 'ok' }],
  };
}

// ── 1. Carta fundacional ─────────────────────────────────────────────────────

describe('E7 — carta fundacional', () => {
  it('generateCharterKeypair produce un par Ed25519 válido', () => {
    const kp = generateCharterKeypair();
    expect(kp.publicKeyPem).toContain('PUBLIC KEY');
    expect(kp.privateKeyPem).toContain('PRIVATE KEY');
  });

  it('buildCharterBody incluye los invariantes de referencia + los del operador', () => {
    const body = buildCharterBody({
      operatorId: 'jefe@shinobi',
      extraInvariants: ['Nunca ejecutar en producción sin staging previo.'],
    });
    expect(body.agentId).toBe('shinobi');
    expect(body.operatorId).toBe('jefe@shinobi');
    expect(body.version).toBe('1.0');
    expect(body.coreInvariants.length).toBe(CORE_INVARIANTS_V1.length + 1);
    // Todos los invariantes de referencia están presentes.
    for (const inv of CORE_INVARIANTS_V1) {
      expect(body.coreInvariants).toContain(inv);
    }
  });

  it('carta firmada → válida (verificable por cualquiera con la pública)', () => {
    const kp = generateCharterKeypair();
    const body = buildCharterBody({ operatorId: 'jefe' });
    const charter = signCharter(body, kp);
    expect(verifyCharter(charter)).toEqual({ valid: true, reason: 'ok' });
  });

  it('manipular el operatorId → hash_mismatch', () => {
    const kp = generateCharterKeypair();
    const body = buildCharterBody({ operatorId: 'jefe' });
    const charter = signCharter(body, kp);
    const tampered = { ...charter, body: { ...charter.body, operatorId: 'intruso' } };
    expect(verifyCharter(tampered)).toEqual({ valid: false, reason: 'hash_mismatch' });
  });

  it('añadir un invariante falso → hash_mismatch', () => {
    const kp = generateCharterKeypair();
    const body = buildCharterBody({ operatorId: 'jefe' });
    const charter = signCharter(body, kp);
    const tampered = { ...charter, body: { ...charter.body, coreInvariants: [...charter.body.coreInvariants, 'Invariante falso añadido post-firma'] } };
    expect(verifyCharter(tampered)).toEqual({ valid: false, reason: 'hash_mismatch' });
  });

  it('sustituir la clave pública → signature_mismatch (forja inviable)', () => {
    const kp = generateCharterKeypair();
    const other = generateCharterKeypair();
    const body = buildCharterBody({ operatorId: 'jefe' });
    const charter = signCharter(body, kp);
    const tampered = { ...charter, publicKeyPem: other.publicKeyPem };
    expect(verifyCharter(tampered)).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  it('dos cartas con mismo operador y fecha producen el mismo charterId', () => {
    const ts = '2026-06-30T00:00:00.000Z';
    const b1 = buildCharterBody({ operatorId: 'jefe', createdAt: ts });
    const b2 = buildCharterBody({ operatorId: 'jefe', createdAt: ts });
    expect(b1.charterId).toBe(b2.charterId);
  });

  it('carta v1 y v2 (nueva) tienen charterId distintos', () => {
    const b1 = buildCharterBody({ operatorId: 'jefe', version: '1.0', createdAt: '2026-01-01T00:00:00Z' });
    const b2 = buildCharterBody({ operatorId: 'jefe', version: '2.0', createdAt: '2026-06-30T00:00:00Z' });
    expect(b1.charterId).not.toBe(b2.charterId);
  });
});

// ── 2. Skill-priors adjustment ───────────────────────────────────────────────

describe('E7 — skill-priors adjustment (circuito Sello→PatternBook)', () => {
  it('certificación sube el hit_rate del patrón', () => {
    const pb = new PatternBook();
    pb.learn('open_file', { cues: ['open', 'file'], seenIn: 'app1' });
    const rec = adjustPrior(pb, 'open_file', certResult('certified'));
    expect(rec).not.toBeNull();
    expect(rec!.outcome).toBe('certified');
    expect(rec!.hitRateAfter).toBeGreaterThan(rec!.hitRateBefore);
  });

  it('descarte baja el hit_rate (o lo mantiene en 0 si no había hits previos)', () => {
    const pb = new PatternBook();
    pb.learn('save_as', { cues: ['save'], seenIn: 'app1' });
    const rec = adjustPrior(pb, 'save_as', certResult('discarded'));
    expect(rec).not.toBeNull();
    expect(rec!.hitRateAfter).toBeLessThanOrEqual(rec!.hitRateBefore);
  });

  it('patrón desconocido → null (no falla)', () => {
    const pb = new PatternBook();
    const rec = adjustPrior(pb, 'idiom_inexistente', certResult('certified'));
    expect(rec).toBeNull();
  });

  it('batch adjustPriors procesa múltiples pares', () => {
    const pb = new PatternBook();
    pb.learn('export', { cues: ['export'], seenIn: 'app1' });
    pb.learn('undo', { cues: ['undo'], seenIn: 'app1' });
    const recs = adjustPriors(pb, [
      { idiom: 'export', certResult: certResult('certified') },
      { idiom: 'undo', certResult: certResult('discarded') },
      { idiom: 'desconocido', certResult: certResult('certified') }, // ignorado
    ]);
    expect(recs.length).toBe(2);
    expect(recs[0].idiom).toBe('export');
    expect(recs[1].idiom).toBe('undo');
  });

  it('estimateCertPrior devuelve 0.5 para patrón desconocido', () => {
    const pb = new PatternBook();
    expect(estimateCertPrior(pb, 'nada')).toBe(0.5);
  });

  it('estimateCertPrior con pocas observaciones modera hacia 0.5', () => {
    const pb = new PatternBook();
    // Simular 1 certificación (high hit_rate pero poca observación)
    pb.learn('new_idiom', { cues: ['x'], seenIn: 'app1' });
    adjustPrior(pb, 'new_idiom', certResult('certified')); // hit_rate = 1.0
    const prior = estimateCertPrior(pb, 'new_idiom');
    // Con 1 observación (seen_in.length=1), debe estar entre 0.5 y 1.0 pero < 1.0
    expect(prior).toBeGreaterThan(0.5);
    expect(prior).toBeLessThan(1.0);
  });

  it('estimateCertPrior con ≥3 observaciones refleja hit_rate real', () => {
    const pb = new PatternBook();
    pb.learn('mature', { cues: ['x'], seenIn: 'app1' });
    // Forzar seen_in a tener ≥3 entradas para superar el umbral
    pb.learn('mature', { cues: ['x'], seenIn: 'app2' });
    pb.learn('mature', { cues: ['x'], seenIn: 'app3' });
    adjustPrior(pb, 'mature', certResult('certified'));   // hit_rate → 1.0
    adjustPrior(pb, 'mature', certResult('certified'));   // hit_rate → 1.0
    adjustPrior(pb, 'mature', certResult('discarded'));   // hit_rate → 0.67
    const prior = estimateCertPrior(pb, 'mature');
    // Con 3 observaciones → usa hit_rate directo (≈0.67)
    expect(prior).toBeCloseTo(2 / 3, 1);
  });
});

// ── 3. Benchmark de verificabilidad E7 (métricas para G5 F4.1) ───────────────

describe('E7 — benchmark de verificabilidad (G5 F4.1)', () => {
  const AUDIT_SAMPLE =
    '{"kind":"tool_call","tool":"read_file","success":true,"durationMs":3}\n' +
    '{"kind":"tool_call","tool":"write_file","success":true,"durationMs":6}';

  it('BENCHMARK: 100% de paquetes legítimos verifican (N=10)', () => {
    const kp = generateProvenanceKeypair();
    const kc = generateCharterKeypair();
    const body = buildCharterBody({ operatorId: 'operador_bench', createdAt: '2026-06-30T00:00:00Z' });
    const charter = signCharter(body, kc);

    let provenanceValid = 0, charterValid = 0;
    const N = 10;

    for (let i = 0; i < N; i++) {
      const pkg = buildSignedProvenance({
        taskId: `task_${i}`, prompt: `tarea ${i}`, finalText: `resultado_${i}`,
        auditText: AUDIT_SAMPLE, verdict: { passed: true },
        privateKeyPem: kp.privateKeyPem, publicKeyPem: kp.publicKeyPem,
        now: () => `2026-06-30T${String(i).padStart(2, '0')}:00:00Z`,
      });
      if (verifySignedProvenance(pkg).valid) provenanceValid++;
      if (verifyCharter(charter).valid) charterValid++;
    }

    expect(provenanceValid).toBe(N);
    expect(charterValid).toBe(N);
  });

  it('BENCHMARK: 100% de tampering detectado en provenance (N=5 × 4 campos)', () => {
    const kp = generateProvenanceKeypair();
    const pkg = buildSignedProvenance({
      taskId: 'bench', prompt: 'p', finalText: 'f',
      auditText: AUDIT_SAMPLE, verdict: { passed: true },
      privateKeyPem: kp.privateKeyPem, publicKeyPem: kp.publicKeyPem,
      now: () => '2026-06-30T00:00:00Z',
    });

    const tamperings = [
      { ...pkg, finalText: 'resultado_falsificado' },
      { ...pkg, taskId: 'task_falso' },
      { ...pkg, auditLog: AUDIT_SAMPLE.replace('read_file', 'evil_read') },
      { ...pkg, publicKeyPem: generateProvenanceKeypair().publicKeyPem },
    ];

    let detected = 0;
    for (const t of tamperings) {
      if (!verifySignedProvenance(t).valid) detected++;
    }
    expect(detected).toBe(tamperings.length); // 100% detectado
  });

  it('BENCHMARK: 100% de tampering detectado en carta fundacional (N=4 campos)', () => {
    const kp = generateCharterKeypair();
    const body = buildCharterBody({ operatorId: 'jefe', createdAt: '2026-06-30T00:00:00Z' });
    const charter = signCharter(body, kp);

    const tamperings = [
      { ...charter, body: { ...charter.body, operatorId: 'intruso' } },
      { ...charter, body: { ...charter.body, coreInvariants: [] } },                          // vaciar invariantes
      { ...charter, publicKeyPem: generateCharterKeypair().publicKeyPem },                    // sustituir clave
      { ...charter, signature: charter.signature.replace('a', 'b') },                         // corromper firma
    ];

    let detected = 0;
    for (const t of tamperings) {
      if (!verifyCharter(t).valid) detected++;
    }
    expect(detected).toBe(tamperings.length); // 100% detectado
  });

  it('BENCHMARK: la misma clave firma carta y provenance — trazabilidad cruzada', () => {
    // Operador usa UNA sola clave para todo: carta fundacional + task provenances.
    const kp = generateCharterKeypair(); // mismo formato que generateProvenanceKeypair()
    const body = buildCharterBody({ operatorId: 'jefe', createdAt: '2026-06-30T00:00:00Z' });
    const charter = signCharter(body, kp);

    const pkg = buildSignedProvenance({
      taskId: 'linked', prompt: 'p', finalText: 'f', auditText: AUDIT_SAMPLE,
      privateKeyPem: kp.privateKeyPem, publicKeyPem: kp.publicKeyPem,
      now: () => '2026-06-30T01:00:00Z',
    });

    // Ambos verifican con la misma clave pública — prueba de trazabilidad operador→agente.
    expect(verifyCharter(charter).valid).toBe(true);
    expect(verifySignedProvenance(pkg).valid).toBe(true);
    // La clave pública embebida en carta y en provenance es la misma.
    expect(charter.publicKeyPem).toBe(pkg.publicKeyPem);
  });
});
