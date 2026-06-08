// src/skills/__tests__/skill_integrity.test.ts
import { describe, it, expect } from 'vitest';
import { sha256Hex, verifyDownloadedSkill, assertDownloadedSkillIntegrity } from '../skill_integrity.js';

const SKILL = '---\nname: X\n---\ncuerpo';

describe('skill integrity (descargadas)', () => {
  it('hash correcto → ok (match)', () => {
    const h = sha256Hex(SKILL);
    const r = verifyDownloadedSkill(SKILL, h);
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('match');
  });

  it('hash incorrecto → falla (mismatch)', () => {
    const r = verifyDownloadedSkill(SKILL, 'deadbeef');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('mismatch');
  });

  it('sin hash esperado → RECHAZA por defecto (fail-closed)', () => {
    const r = verifyDownloadedSkill(SKILL);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing_expected');
  });

  it('sin hash + failClosed:false → permite (fuente confiable)', () => {
    expect(verifyDownloadedSkill(SKILL, undefined, { failClosed: false }).ok).toBe(true);
  });

  it('assert lanza si no pasa, no lanza si pasa', () => {
    expect(() => assertDownloadedSkillIntegrity(SKILL, sha256Hex(SKILL))).not.toThrow();
    expect(() => assertDownloadedSkillIntegrity(SKILL, 'bad')).toThrow(/no coincide/i);
    expect(() => assertDownloadedSkillIntegrity(SKILL)).toThrow(/fail-closed/i);
  });
});
