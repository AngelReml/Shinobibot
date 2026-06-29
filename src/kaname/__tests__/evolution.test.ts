/**
 * KN-05 (catálogo + load/unload), KN-07 (ancla de oráculo, P5), KN-08 (no-auto-
 * promoción, P6), KN-09 (promoción versionada + reversión, P7).
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import { KanameStore } from '../store.js';
import { loadIntoCatalog, unloadSkill, runOracleBattery, admitToUserspace, canPromote, promoteKernel, revertKernel, type OracleRunner } from '../evolution.js';
import { coreHash } from '../immutability.js';
import { canonicalHashPorted, type SkillCSVLike } from '../../integrity/csv_verify.js';
import type { SkillManifestLite, KernelVersion } from '../types.js';

/** Build a genuinely valid (CERTIFIED + signed) CSV for a skill — matches verifyCsvCertificate. */
function validCsv(skillId: string): SkillCSVLike {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const csv: any = { csv_version: '1', subject: { skill_id: skillId, skill_artifact_hash: 'sha256:x' }, verdict: 'CERTIFIED', integrity: { verifier_pubkey: pub } };
  const hashable = JSON.parse(JSON.stringify(csv));
  delete hashable.integrity.this_hash; delete hashable.integrity.signature;
  const this_hash = 'sha256:' + canonicalHashPorted(hashable);
  const sig = crypto.sign(null, Buffer.from(this_hash, 'utf-8'), privateKey).toString('hex');
  csv.integrity.this_hash = this_hash;
  csv.integrity.signature = { alg: 'ed25519', sig_hex: sig };
  return csv as SkillCSVLike;
}

const stores: KanameStore[] = [];
const mem = () => { const s = new KanameStore({ db_path: ':memory:' }); stores.push(s); return s; };
afterEach(() => { while (stores.length) stores.pop()!.close(); });

const manifest: SkillManifestLite = { skill_id: 'x.v1', declared_tools: ['read_file'], declared_effects: 'read_only' };
const pass: OracleRunner = async () => ({ name: 'hard_test', pass: true, raw: 'P1-P7 green' });
const fail: OracleRunner = async () => ({ name: 'hard_test', pass: false, raw: '1 failed' });

describe('kaname — KN-05 catálogo + load/unload (P3 + no toca el núcleo)', () => {
  it('rechaza sin CSV; cargar/descargar no altera el hash del núcleo', () => {
    const s = mem();
    const core = [{ path: 'src/integrity/a.ts', content: 'x' }];
    const h0 = coreHash(core);
    const r = loadIntoCatalog(s, manifest, null, { createdBy: 'swarm' });
    expect(r.admitted).toBe(false);                       // P3: sin CSV no entra
    expect(s.getSkill('x.v1')!.status).toBe('rejected');
    unloadSkill(s, 'x.v1');
    expect(s.getSkill('x.v1')!.status).toBe('isolated');  // descarga aislada
    expect(coreHash(core)).toBe(h0);                      // el hash del núcleo no cambió
  });
});

describe('kaname — KN-07 ancla de oráculo (P5)', () => {
  it('una skill que el constructor reporta "lista" pero falla el oráculo NO entra', async () => {
    const s = mem();
    const csv = validCsv('x.v1');           // CSV genuinamente válido → la puerta de CSV se abre
    const r = await admitToUserspace(s, manifest, csv, fail, { createdBy: 'swarm' });
    expect(r.admitted).toBe(false);
    expect(r.reason).toMatch(/oráculo rojo/);
    expect(s.getSkill('x.v1')!.status).toBe('rejected');  // el árbitro es el oráculo, no el worker
  });
  it('sin CSV no llega ni a correr el oráculo', async () => {
    const s = mem();
    const r = await admitToUserspace(s, manifest, null, pass);
    expect(r.admitted).toBe(false); expect(r.reason).toMatch(/sin CSV/);
  });
});

describe('kaname — KN-08 no-auto-promoción (P6)', () => {
  it('batería verde sólo si TODO pasa; una regresión la pone roja', async () => {
    expect((await runOracleBattery([pass, pass])).green).toBe(true);
    const red = await runOracleBattery([pass, fail]);   // regresión plantada
    expect(red.green).toBe(false);
    expect(canPromote(red)).toBe(false);                 // no se auto-promociona en rojo
  });
});

describe('kaname — KN-09 evolución + reversión (P7)', () => {
  const v1: KernelVersion = { version: '1.0', hash: 'sha256:aaa', promoted_at: '2026-01-01', dojo_hard_tests: 'green', suite: { passed: 1470, skipped: 1 } };
  it('promociona sólo con batería verde + pruebas duras verde; bloquea lo que rompe', async () => {
    const s = mem();
    const green = await runOracleBattery([pass]);
    expect(promoteKernel(s, v1, green).promoted).toBe(true);
    expect(s.latestVersion()!.version).toBe('1.0');

    const v2bad: KernelVersion = { ...v1, version: '1.1', dojo_hard_tests: 'red' };
    expect(promoteKernel(s, v2bad, green).promoted).toBe(false);            // pruebas duras rojas
    const red = await runOracleBattery([fail]);
    expect(promoteKernel(s, { ...v1, version: '1.2' }, red).promoted).toBe(false);  // oráculo rojo
  });
  it('revertir restaura una versión previa conocida-verde y la hace head', async () => {
    const s = mem();
    promoteKernel(s, v1, await runOracleBattery([pass]));
    promoteKernel(s, { ...v1, version: '1.1', promoted_at: '2026-02-01' }, await runOracleBattery([pass]));
    // latestVersion() apunta a 1.1 antes del revert
    expect(s.latestVersion()!.version).toBe('1.1');
    // revertKernel devuelve la versión objetivo
    const reverted = revertKernel(s, '1.0');
    expect(reverted!.version).toBe('1.0');
    // Y la hace la head real (promoted_at actualizado → latestVersion() apunta a 1.0)
    expect(s.latestVersion()!.version).toBe('1.0');
    // versión inexistente devuelve null
    expect(revertKernel(s, '9.9')).toBeNull();
  });
});
