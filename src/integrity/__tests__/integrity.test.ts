import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCsvCertificate, hashArtifactFile } from '../csv_verify.js';
import { classifyEffect, effectWithin } from '../effects.js';
import { check11_1, check11_2, check11_4 } from '../checks.js';
import { runPreAction, runPostAction, reportClaimsSuccess } from '../engine.js';
import type { IntegrityStep, SkillBinding } from '../types.js';

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const csv = JSON.parse(fs.readFileSync(path.join(FIX, 'certified.csv.json'), 'utf-8'));
const artifactPath = path.join(FIX, 'skill.mjs');

const baseSkill: SkillBinding = {
  skill_id: 'payment.authorize.v1', declared_tools: ['read_file'], declared_effects: 'read_only',
  csv, artifact_path: artifactPath,
};
function step(skill: SkillBinding | null, action = { tool: 'read_file', args: {} }, risk: 'low' | 'high' = 'high'): IntegrityStep {
  return { step: 1, action, skill, risk };
}

describe('csv_verify — self-contained CSV verification', () => {
  it('valid CERTIFIED certificate verifies ok', () => {
    const r = verifyCsvCertificate(csv);
    expect(r.this_hash_ok).toBe(true);
    expect(r.signature_ok).toBe(true);
    expect(r.certified).toBe(true);
    expect(r.ok).toBe(true);
  });
  it('tampering a signed field breaks this_hash', () => {
    const t = JSON.parse(JSON.stringify(csv)); t.subject.skill_id = 'evil';
    const r = verifyCsvCertificate(t);
    expect(r.this_hash_ok).toBe(false);
    expect(r.ok).toBe(false);
  });
  it('artifact fixture hashes to the certified skill_artifact_hash', () => {
    expect(hashArtifactFile(artifactPath)).toBe(csv.subject.skill_artifact_hash);
  });
});

describe('effects model (11.2)', () => {
  it('classifies read/write/irreversible and unknown fail-closed', () => {
    expect(classifyEffect('read_file')).toBe('read_only');
    expect(classifyEffect('write_file')).toBe('write');
    expect(classifyEffect('run_command')).toBe('irreversible');
    expect(classifyEffect('some_unknown_tool')).toBe('write');
  });
  it('within: read_only ⊆ read_only, write ⊄ read_only', () => {
    expect(effectWithin('read_only', 'read_only')).toBe(true);
    expect(effectWithin('write', 'read_only')).toBe(false);
  });
});

describe('check 11.1 — skill has a valid CSV', () => {
  it('CLEAN: certified + artifact matches → ok', () => {
    expect(check11_1(step(baseSkill)).ok).toBe(true);
  });
  it('no skill → UNVERIFIED_SKILL', () => {
    const r = check11_1(step(null));
    expect(r.ok).toBe(false); expect(r.flag).toBe('UNVERIFIED_SKILL');
  });
  it('tampered CSV → CSV_INVALID', () => {
    const t = JSON.parse(JSON.stringify(csv)); t.subject.skill_id = 'evil';
    const r = check11_1(step({ ...baseSkill, csv: t }));
    expect(r.ok).toBe(false); expect(r.flag).toBe('CSV_INVALID');
  });
  it('on-disk artifact != certified → ARTIFACT_MISMATCH', () => {
    const bad = path.join(os.tmpdir(), 'integrity_test_bad.mjs');
    fs.writeFileSync(bad, fs.readFileSync(artifactPath, 'utf-8') + '\n// tampered');
    const r = check11_1(step({ ...baseSkill, artifact_path: bad }));
    expect(r.ok).toBe(false); expect(r.flag).toBe('ARTIFACT_MISMATCH');
  });
});

describe('check 11.2 — action ⊆ declared effects/tools', () => {
  it('CLEAN: declared tool + effect within → ok', () => {
    expect(check11_2(step(baseSkill)).ok).toBe(true);
  });
  it('tool not declared → TOOL_NOT_DECLARED', () => {
    const r = check11_2(step(baseSkill, { tool: 'write_file', args: {} }));
    expect(r.ok).toBe(false); expect(r.flag).toBe('TOOL_NOT_DECLARED');
  });
  it('declared tool but effect exceeds declared → EFFECTS_VIOLATION', () => {
    const r = check11_2(step({ ...baseSkill, declared_tools: ['edit_file'] }, { tool: 'edit_file', args: {} }));
    expect(r.ok).toBe(false); expect(r.flag).toBe('EFFECTS_VIOLATION');
  });
});

describe('check 11.4 — reported == real (post-action)', () => {
  it('CLEAN: tool ok + agent claims success → ok', () => {
    expect(check11_4({ tool: 't', real: { success: true, output: 'done' }, reported: { claims_success: true }, risk: 'low' }).ok).toBe(true);
  });
  it('CLEAN: tool failed + agent acknowledges failure → ok', () => {
    expect(check11_4({ tool: 't', real: { success: false, output: 'err' }, reported: { claims_success: false }, risk: 'low' }).ok).toBe(true);
  });
  it('FABRICATION: tool failed but agent claims success', () => {
    const r = check11_4({ tool: 't', real: { success: false, output: 'err' }, reported: { claims_success: true }, risk: 'low' });
    expect(r.ok).toBe(false); expect(r.flag).toBe('FABRICATION');
  });
  it('FABRICATION: agent claims a value absent from the real output', () => {
    const r = check11_4({ tool: 't', real: { success: true, output: 'balance: 0' }, reported: { claims_success: true, claim: 'balance: 1000000' }, risk: 'low' });
    expect(r.ok).toBe(false); expect(r.flag).toBe('FABRICATION');
  });
  it('reportClaimsSuccess detects completion language (es/en) and ignores neutral text', () => {
    expect(reportClaimsSuccess('La transferencia se ha completado con éxito')).toBe(true);
    expect(reportClaimsSuccess('done ✅')).toBe(true);
    expect(reportClaimsSuccess('the operation failed, retrying with other args')).toBe(false);
  });
  it('engine post-action halts a fabrication at enforce/high risk', () => {
    const v = runPostAction({ tool: 't', real: { success: false, output: 'err' }, reported: { claims_success: true }, risk: 'high' });
    expect(v.ok).toBe(false); expect(v.action).toBe('halt'); expect(v.flags).toContain('FABRICATION');
  });
});

describe('engine — clean proceeds, each violation halts at high risk', () => {
  it('CLEAN → ok + proceed, no flags', () => {
    const v = runPreAction(step(baseSkill));
    expect(v.ok).toBe(true); expect(v.action).toBe('proceed'); expect(v.flags).toEqual([]);
  });
  it('violation at high risk → halt with the flag', () => {
    const v = runPreAction(step(null));
    expect(v.ok).toBe(false); expect(v.action).toBe('halt');
    expect(v.flags).toContain('UNVERIFIED_SKILL');
  });
});
