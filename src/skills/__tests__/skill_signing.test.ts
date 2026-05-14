import { describe, it, expect } from 'vitest';
import {
  computeSkillHash,
  signSkill,
  signSkillText,
  verifySkill,
  verifySkillText,
  extractProvenance,
  SIGNATURE_FIELDS,
} from '../skill_signing.js';
import { parseSkillMd, serializeSkillMd } from '../skill_md_parser.js';

const SAMPLE_TEXT = `---
name: deploy_helper
description: Helps deploy stuff
trigger_keywords: [deploy, ship, release]
model_recommended: claude-haiku
status: pending
source: auto
---

# Deploy Helper

Step 1: do X.
Step 2: do Y.
`;

describe('computeSkillHash', () => {
  it('es determinista', () => {
    const a = computeSkillHash(parseSkillMd(SAMPLE_TEXT));
    const b = computeSkillHash(parseSkillMd(SAMPLE_TEXT));
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('cambia si el body cambia', () => {
    const a = computeSkillHash(parseSkillMd(SAMPLE_TEXT));
    const tampered = SAMPLE_TEXT.replace('Step 1: do X.', 'Step 1: do EVIL.');
    const b = computeSkillHash(parseSkillMd(tampered));
    expect(a).not.toBe(b);
  });

  it('cambia si el frontmatter (no-firma) cambia', () => {
    const a = computeSkillHash(parseSkillMd(SAMPLE_TEXT));
    const tampered = SAMPLE_TEXT.replace('trigger_keywords: [deploy, ship, release]', 'trigger_keywords: [deploy, ship, release, exfiltrate]');
    const b = computeSkillHash(parseSkillMd(tampered));
    expect(a).not.toBe(b);
  });

  it('NO cambia si solo varían los campos de firma', () => {
    const base = parseSkillMd(SAMPLE_TEXT);
    const withSig = {
      frontmatter: { ...base.frontmatter, signature_hash: 'x'.repeat(64), signed_at: '2026-01-01T00:00:00Z', signed_by: 'auto' },
      body: base.body,
    };
    expect(computeSkillHash(base)).toBe(computeSkillHash(withSig));
  });

  it('el orden de claves del frontmatter no afecta el hash', () => {
    const a = parseSkillMd(SAMPLE_TEXT);
    const reordered = {
      frontmatter: Object.fromEntries(Object.entries(a.frontmatter).reverse()),
      body: a.body,
    };
    expect(computeSkillHash(a)).toBe(computeSkillHash(reordered));
  });
});

describe('signSkill', () => {
  it('añade signature_hash + signed_at + signed_by', () => {
    const parsed = parseSkillMd(SAMPLE_TEXT);
    const signed = signSkill(parsed, { author: 'auto', now: () => '2026-05-14T10:00:00Z' });
    expect(signed.frontmatter.signature_hash).toHaveLength(64);
    expect(signed.frontmatter.signed_at).toBe('2026-05-14T10:00:00Z');
    expect(signed.frontmatter.signed_by).toBe('auto');
  });

  it('no muta el input', () => {
    const parsed = parseSkillMd(SAMPLE_TEXT);
    const before = JSON.stringify(parsed);
    signSkill(parsed);
    expect(JSON.stringify(parsed)).toBe(before);
  });

  it('firmar dos veces produce el mismo hash (solo cambia signed_at)', () => {
    const parsed = parseSkillMd(SAMPLE_TEXT);
    const s1 = signSkill(parsed, { now: () => '2026-05-14T10:00:00Z' });
    const s2 = signSkill(parsed, { now: () => '2026-05-14T11:00:00Z' });
    expect(s1.frontmatter.signature_hash).toBe(s2.frontmatter.signature_hash);
    expect(s1.frontmatter.signed_at).not.toBe(s2.frontmatter.signed_at);
  });

  it('firmar una skill ya firmada produce mismo hash', () => {
    const parsed = parseSkillMd(SAMPLE_TEXT);
    const s1 = signSkill(parsed);
    const s2 = signSkill(s1);
    expect(s1.frontmatter.signature_hash).toBe(s2.frontmatter.signature_hash);
  });
});

describe('signSkillText / round-trip', () => {
  it('texto firmado verifica positivamente', () => {
    const signed = signSkillText(SAMPLE_TEXT, { author: 'user', now: () => '2026-05-14T10:00:00Z' });
    const v = verifySkillText(signed);
    expect(v.valid).toBe(true);
  });

  it('signed_by aparece en el texto', () => {
    const signed = signSkillText(SAMPLE_TEXT, { author: 'angelreml' });
    expect(signed).toContain('signed_by: angelreml');
  });
});

describe('verifySkill — detecta tampering', () => {
  it('skill sin signature_hash → missing_signature', () => {
    const v = verifySkill(parseSkillMd(SAMPLE_TEXT));
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('missing_signature');
  });

  it('skill con hash de longitud incorrecta → missing_signature', () => {
    const parsed = parseSkillMd(SAMPLE_TEXT);
    parsed.frontmatter.signature_hash = 'short';
    expect(verifySkill(parsed).reason).toBe('missing_signature');
  });

  it('tamper en body → hash_mismatch', () => {
    const signed = signSkillText(SAMPLE_TEXT);
    const tampered = signed.replace('Step 1: do X.', 'Step 1: do EVIL.');
    const v = verifySkillText(tampered);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('hash_mismatch');
    expect(v.expectedHash).toBeTruthy();
    expect(v.actualHash).toBeTruthy();
    expect(v.expectedHash).not.toBe(v.actualHash);
  });

  it('tamper en frontmatter (no-firma) → hash_mismatch', () => {
    const signed = signSkillText(SAMPLE_TEXT);
    const tampered = signed.replace(
      'trigger_keywords: [deploy, ship, release]',
      'trigger_keywords: [deploy, ship, release, leak_secrets]',
    );
    const v = verifySkillText(tampered);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('hash_mismatch');
  });

  it('cambiar signed_at NO invalida (la firma es del contenido, no del timestamp)', () => {
    const signedAtA = signSkillText(SAMPLE_TEXT, { now: () => '2026-05-14T10:00:00Z' });
    const parsed = parseSkillMd(signedAtA);
    parsed.frontmatter.signed_at = '2030-01-01T00:00:00Z';
    expect(verifySkill(parsed).valid).toBe(true);
  });
});

describe('extractProvenance', () => {
  it('devuelve los 3 campos cuando están presentes', () => {
    const signed = signSkill(parseSkillMd(SAMPLE_TEXT), { author: 'user', now: () => '2026-05-14T10:00:00Z' });
    const prov = extractProvenance(signed.frontmatter);
    expect(prov.hash).toHaveLength(64);
    expect(prov.signedAt).toBe('2026-05-14T10:00:00Z');
    expect(prov.signedBy).toBe('user');
  });
  it('devuelve undefined cuando faltan', () => {
    const prov = extractProvenance({});
    expect(prov.hash).toBeUndefined();
    expect(prov.signedAt).toBeUndefined();
    expect(prov.signedBy).toBeUndefined();
  });
});

describe('SIGNATURE_FIELDS constante', () => {
  it('lista los 3 campos correctos', () => {
    expect(SIGNATURE_FIELDS).toEqual(['signature_hash', 'signed_at', 'signed_by']);
  });
});

describe('parseSkillMd round-trip funciona con skill firmada', () => {
  it('parse → sign → serialize → parse → verify', () => {
    const parsed1 = parseSkillMd(SAMPLE_TEXT);
    const signed = signSkill(parsed1);
    const serialized = serializeSkillMd(signed);
    const parsed2 = parseSkillMd(serialized);
    expect(verifySkill(parsed2).valid).toBe(true);
  });
});
