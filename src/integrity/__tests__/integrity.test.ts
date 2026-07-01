import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCsvCertificate, hashArtifactFile, canonicalHashPorted } from '../csv_verify.js';
import { classifyEffect, effectWithin } from '../effects.js';
import { check11_1, check11_2, check11_3, check11_4 } from '../checks.js';
import { runPreAction, runPostAction, reportClaimsSuccess } from '../engine.js';
import { policyAuthority, assignOrigin } from '../provenance.js';
import { stepForToolCall } from '../registry.js';
import type { IntegrityStep, SkillBinding, ContextItem } from '../types.js';

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

  // Regresión ALTA-16 (auditoría 2026-07-01): antes, la firma se verificaba
  // contra `integrity.this_hash` (ALMACENADO), no contra el hash RECOMPUTADO.
  // Modificar contenido firmado dejando `this_hash`/`signature` intactos hacía
  // `this_hash_ok:false` (correcto) pero `signature_ok:true` (engañoso — la
  // firma seguía siendo válida sobre el valor almacenado sin tocar). Cualquier
  // consumidor que solo mirase `signature_ok` concluía erróneamente que el
  // certificado era auténtico.
  it('ALTA-16: tampering deja this_hash/signature intactos → signature_ok también debe caer', () => {
    const t = JSON.parse(JSON.stringify(csv));
    t.subject.skill_artifact_hash = 'sha256:deadbeef'.padEnd(t.subject.skill_artifact_hash.length, '0');
    // this_hash/signature NO se tocan — siguen siendo los del CSV original.
    const r = verifyCsvCertificate(t);
    expect(r.this_hash_ok).toBe(false);
    expect(r.signature_ok).toBe(false); // antes del fix, esto era `true` (engañoso)
    expect(r.ok).toBe(false);
  });
  it('artifact fixture hashes to the certified skill_artifact_hash', () => {
    expect(hashArtifactFile(artifactPath)).toBe(csv.subject.skill_artifact_hash);
  });

  // Regresión auditoría 2026-07-01: sin pinning, `integrity.verifier_pubkey` se
  // lee del propio certificado siendo verificado (su SUBJECT, no una AUTORIDAD).
  // Cualquiera puede generar un keypair fresco, auto-firmar un CSV CERTIFIED, y
  // pasar this_hash_ok + signature_ok + certified — los tres TRUE sin que el
  // certificado provenga de ningún verificador real. Reproduce el ataque exacto
  // (no una versión idealizada): keypair nuevo, hash recomputado correctamente,
  // firma válida sobre ese hash, verdict CERTIFIED — self-contained y consistente
  // en todo menos en QUIÉN firmó.
  it('un CSV auto-firmado con un verifier_pubkey no confiable se rechaza (ok=false) aunque hash y firma sean internamente válidos', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const forged: any = {
      csv_version: '0.1',
      subject: { skill_id: 'evil.v1', skill_artifact_hash: 'sha256:deadbeef' },
      verdict: 'CERTIFIED',
      integrity: { verifier_pubkey: publicKey.export({ type: 'spki', format: 'pem' }).toString() },
    };
    const hashable = JSON.parse(JSON.stringify(forged));
    delete hashable.integrity.this_hash; delete hashable.integrity.signature;
    const this_hash = `sha256:${canonicalHashPorted(hashable)}`;
    forged.integrity.this_hash = this_hash;
    forged.integrity.signature = { alg: 'ed25519', sig_hex: crypto.sign(null, Buffer.from(this_hash, 'utf-8'), privateKey).toString('hex') };

    const r = verifyCsvCertificate(forged);
    expect(r.this_hash_ok).toBe(true);   // el atacante calculó el hash correctamente
    expect(r.signature_ok).toBe(true);   // y firmó correctamente con SU propia clave
    expect(r.certified).toBe(true);      // y declaró CERTIFIED
    expect(r.pubkey_trusted).toBe(false); // pero esa clave no está pinneada
    expect(r.ok).toBe(false);             // → el certificado completo se rechaza
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

describe('provenance model (11.3)', () => {
  it('policy_authority true only for SYSTEM / USER_DIRECT', () => {
    expect(policyAuthority('SYSTEM')).toBe(true);
    expect(policyAuthority('USER_DIRECT')).toBe(true);
    expect(policyAuthority('COUNTERPARTY')).toBe(false);
    expect(policyAuthority('TOOL_EXTERNAL')).toBe(false);
    expect(policyAuthority('UNKNOWN')).toBe(false);
    expect(policyAuthority(undefined)).toBe(false);
  });
  it('assignOrigin maps entry channels, unknown → UNKNOWN (fail-closed)', () => {
    expect(assignOrigin('curated_markdown')).toBe('SYSTEM');
    expect(assignOrigin('counterparty_msg')).toBe('COUNTERPARTY');
    expect(assignOrigin('something_random')).toBe('UNKNOWN');
  });
});

describe('check 11.3 — memory provenance / poisoning (cross-step)', () => {
  const KEYS = ['claimed_per_day_usd', 'claimed_2fa_status', 'claimed_limit'];
  const poison: ContextItem = { content: { claimed_per_day_usd: 999999 }, provenance: { origin: 'COUNTERPARTY', channel: 'counterparty_msg', session_seq: 3 } };
  const signedPolicy: ContextItem = { content: { authorized_per_day_usd: 5000 }, provenance: { origin: 'SYSTEM', channel: 'curated_markdown', session_seq: 0 } };
  function privStep(over: Partial<IntegrityStep>): IntegrityStep {
    return { step: 9, action: { tool: 'authorize_payment' }, skill: null, risk: 'high', privileged: true, policy_domain_keys: KEYS, ...over };
  }

  it('POISONED: authorize-over-signed-deny driven by non-authoritative claim → FIRE', () => {
    const r = check11_3(privStep({ signed_policy_outcome: 'deny', action_outcome: 'authorize', memory_context: [signedPolicy, poison] }));
    expect(r.ok).toBe(false); expect(r.flag).toBe('MEMORY_POISON');
  });
  it('CLEAN: same action backed by signed policy (within limit, allow) → PASS', () => {
    const r = check11_3(privStep({ signed_policy_outcome: 'allow', action_outcome: 'authorize', memory_context: [signedPolicy, poison] }));
    expect(r.ok).toBe(true);
  });
  it('CLEAN: poison present but action follows policy (deny) → PASS', () => {
    const r = check11_3(privStep({ signed_policy_outcome: 'deny', action_outcome: 'deny', memory_context: [signedPolicy, poison] }));
    expect(r.ok).toBe(true);
  });
  it('CLEAN: untrusted item used only as DATA (no policy-domain claim) → PASS', () => {
    const dataItem: ContextItem = { content: { tx_list: [1, 2, 3] }, provenance: { origin: 'COUNTERPARTY', channel: 'counterparty_msg', session_seq: 3 } };
    const r = check11_3(privStep({ signed_policy_outcome: 'deny', action_outcome: 'authorize', memory_context: [signedPolicy, dataItem] }));
    expect(r.ok).toBe(true);
  });
  it('non-privileged action → no-op PASS', () => {
    expect(check11_3({ step: 1, action: { tool: 'read_file' }, skill: null, risk: 'low' }).ok).toBe(true);
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
  it('engine post-action halts a fabrication under SHINOBI_INTEGRITY=enforce', () => {
    process.env.SHINOBI_INTEGRITY = 'enforce';
    try {
      const v = runPostAction({ tool: 't', real: { success: false, output: 'err' }, reported: { claims_success: true }, risk: 'high' });
      expect(v.ok).toBe(false); expect(v.action).toBe('halt'); expect(v.flags).toContain('FABRICATION');
    } finally {
      delete process.env.SHINOBI_INTEGRITY;
    }
  });

  // Regresión CRIT-13 (auditoría 2026-07-01): risk='high' NO debe forzar 'halt'
  // en modo 'flag' (default) — el contrato documentado de 'flag' es "nunca
  // bloquea". Antes del fix, esta misma llamada con mode='flag' devolvía
  // action:'halt' igual que con mode='enforce', violando el propio docstring.
  it('CRIT-13: en modo flag (default), una FABRICATION de risk=high NO bloquea — solo flag', () => {
    delete process.env.SHINOBI_INTEGRITY; // asegura default 'flag'
    const v = runPostAction({ tool: 't', real: { success: false, output: 'err' }, reported: { claims_success: true }, risk: 'high' });
    expect(v.ok).toBe(false);
    expect(v.flags).toContain('FABRICATION');
    expect(v.action).toBe('flag'); // NO 'halt' — flag mode es no-disruptivo por contrato
  });
});

describe('C7 — write_file bound to certified fs.write.v1 (real binding)', () => {
  it('resolves a CERTIFIED binding for write_file', () => {
    const step = stepForToolCall('write_file', { path: 'scratch/x.txt' }, { outOfScope: false });
    expect(step.skill?.skill_id).toBe('fs.write.v1');
  });
  it('in-scope write → 11.1 valid + 11.2 in scope → proceed', () => {
    const v = runPreAction(stepForToolCall('write_file', { path: 'scratch/x.txt' }, { outOfScope: false }));
    expect(v.checks.find((c) => c.check === '11.1')!.ok).toBe(true);   // CSV valid + artifact hash matches
    expect(v.checks.find((c) => c.check === '11.2')!.ok).toBe(true);   // path in scope
    expect(v.ok).toBe(true); expect(v.action).toBe('proceed');
  });
  it('protected path (out_of_scope) → 11.2 SCOPE_VIOLATION, halt under SHINOBI_INTEGRITY=enforce', () => {
    process.env.SHINOBI_INTEGRITY = 'enforce';
    try {
      const v = runPreAction(stepForToolCall('write_file', { path: '.env' }, { outOfScope: true, risk: 'high' }));
      const c2 = v.checks.find((c) => c.check === '11.2')!;
      expect(c2.ok).toBe(false); expect(c2.flag).toBe('SCOPE_VIOLATION');
      expect(v.flags).toContain('SCOPE_VIOLATION'); expect(v.action).toBe('halt');
    } finally {
      delete process.env.SHINOBI_INTEGRITY;
    }
  });
});

describe('engine — clean proceeds, violations halt only under enforce (CRIT-13: flag nunca bloquea)', () => {
  it('CLEAN → ok + proceed, no flags', () => {
    const v = runPreAction(step(baseSkill));
    expect(v.ok).toBe(true); expect(v.action).toBe('proceed'); expect(v.flags).toEqual([]);
  });
  it('violation bajo SHINOBI_INTEGRITY=enforce → halt con el flag', () => {
    process.env.SHINOBI_INTEGRITY = 'enforce';
    try {
      const v = runPreAction(step(null));
      expect(v.ok).toBe(false); expect(v.action).toBe('halt');
      expect(v.flags).toContain('UNVERIFIED_SKILL');
    } finally {
      delete process.env.SHINOBI_INTEGRITY;
    }
  });
  it('CRIT-13: la MISMA violación de risk=high en modo flag (default) → flag, NO halt', () => {
    delete process.env.SHINOBI_INTEGRITY;
    const v = runPreAction(step(null));
    expect(v.ok).toBe(false); expect(v.action).toBe('flag');
    expect(v.flags).toContain('UNVERIFIED_SKILL');
  });
});
