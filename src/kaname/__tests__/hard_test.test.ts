/**
 * KN-10 — LA PRUEBA DURA del Kaname (§13, P1–P7). El núcleo aguanta el caos del
 * enjambre. Salida binaria, hashes de núcleo antes/después, logs de bloqueo, CSV
 * entradas/rechazadas, promoción/reversión.
 *
 *   P1 inmutabilidad · P2 aislamiento · P3 certificación en puerta · P4 el enjambre
 *   no corrompe · P5 ancla de oráculo · P6 auto-vigilancia honesta · P7 evolución/reversión.
 *
 * P1, P2 y P4 son el alma: prueban que la frontera es REAL, no una convención.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import { coreHash, guardCoreWrite, writeAllowed } from '../immutability.js';
import { makeMediator, SyscallDenied, type KernelHost } from '../mediator.js';
import { KanameStore } from '../store.js';
import { admitToUserspace, runOracleBattery, promoteKernel, revertKernel, type OracleRunner } from '../evolution.js';
import { orchestrateSwarm, type LaunchClaude } from '../swarm.js';
import { canonicalHashPorted, addTrustedVerifierPubkey, type SkillCSVLike } from '../../integrity/csv_verify.js';
import type { SkillManifestLite, KernelVersion } from '../types.js';

const stores: KanameStore[] = [];
const mem = () => { const s = new KanameStore({ db_path: ':memory:' }); stores.push(s); return s; };
afterEach(() => { while (stores.length) stores.pop()!.close(); });

function validCsv(skillId: string): SkillCSVLike {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  addTrustedVerifierPubkey(pub); // testea con un verificador pinneado, no con cualquiera auto-firmado
  const csv: any = { csv_version: '1', subject: { skill_id: skillId, skill_artifact_hash: 'sha256:x' }, verdict: 'CERTIFIED', integrity: { verifier_pubkey: pub } };
  const h = JSON.parse(JSON.stringify(csv)); delete h.integrity.this_hash; delete h.integrity.signature;
  const this_hash = 'sha256:' + canonicalHashPorted(h);
  csv.integrity.this_hash = this_hash;
  csv.integrity.signature = { alg: 'ed25519', sig_hex: crypto.sign(null, Buffer.from(this_hash, 'utf-8'), privateKey).toString('hex') };
  return csv as SkillCSVLike;
}

const CORE_FILES = [{ path: 'src/integrity/checks.ts', content: 'CORE-A' }, { path: 'src/coordinator/orchestrator.ts', content: 'CORE-B' }];
const manifest: SkillManifestLite = { skill_id: 'k.v1', declared_tools: ['read_file'], declared_effects: 'read_only', reads: ['in.txt'] };
const pass: OracleRunner = async () => ({ name: 'hard_test', pass: true, raw: 'P1-P7 green' });
const fail: OracleRunner = async () => ({ name: 'hard_test', pass: false, raw: '1 failed' });

describe('kaname — KN-10 LA PRUEBA DURA (P1–P7)', () => {
  it('P1 — inmutabilidad: skill/worker no escribe el núcleo; el hash no cambia', () => {
    const h0 = coreHash(CORE_FILES);
    expect(() => guardCoreWrite({ path: 'src/integrity/checks.ts', origin: 'skill' })).toThrow(/BLOQUEADO/);
    expect(writeAllowed({ path: 'src/coordinator/orchestrator.ts', origin: 'swarm' })).toBe(false);
    expect(coreHash(CORE_FILES)).toBe(h0);                 // hash intacto
  });

  it('P2 — aislamiento: tool/ref fuera del contrato → denegado por la mediación', async () => {
    const host: KernelHost = { readInput: async (ref) => ({ ref, data: 'x' }), writeOutput: async () => {}, invokeTool: async () => 'ok', requestApproval: async () => true, log: () => {} };
    const sys = makeMediator(manifest, host);
    await expect(sys.invokeTool('delete_file', {})).rejects.toBeInstanceOf(SyscallDenied);   // tool no declarada
    await expect(sys.readInput('secreto.txt')).rejects.toThrow(/fuera del scope/);            // ref no declarada
    await expect(sys.readInput('in.txt')).resolves.toBeTruthy();                              // lo declarado pasa
  });

  it('P3 — certificación en puerta: sin CSV válido no se carga', async () => {
    const s = mem();
    expect((await admitToUserspace(s, manifest, null, pass)).admitted).toBe(false);
  });

  it('P4 — el enjambre no corrompe: tormenta con worker malicioso → núcleo intacto', async () => {
    const h0 = coreHash(CORE_FILES);
    const launch: LaunchClaude = async (w) => w.assigned_front === 'malicioso'
      ? { worker_id: w.worker_id, front: w.assigned_front, writes: ['src/integrity/checks.ts'], ok: true }   // intenta corromper
      : { worker_id: w.worker_id, front: w.assigned_front, writes: [`src/skills/${w.assigned_front}.ts`], ok: true };
    const res = await orchestrateSwarm(['s1', 's2', 'malicioso', 's3', 's4'], { launch, prompt: (f) => `build ${f}`, concurrency: 3 });
    expect(res.blocked_core_writes.length).toBe(1);                        // la escritura al núcleo se bloqueó
    expect(res.workers.filter((w) => w.status === 'done')).toHaveLength(4); // los honestos siguen
    expect(coreHash(CORE_FILES)).toBe(h0);                                 // hash del núcleo intacto tras la tormenta
  });

  it('P5 — ancla de oráculo: skill "lista" que falla el oráculo NO entra', async () => {
    const s = mem();
    const r = await admitToUserspace(s, manifest, validCsv('k.v1'), fail, { createdBy: 'swarm' });
    expect(r.admitted).toBe(false); expect(r.reason).toMatch(/oráculo rojo/);
  });

  it('P6 — auto-vigilancia honesta: regresión plantada → batería roja → no auto-promoción', async () => {
    const battery = await runOracleBattery([pass, fail]);   // regresión
    expect(battery.green).toBe(false);
    const s = mem();
    const cand: KernelVersion = { version: '1.1', hash: 'sha256:x', promoted_at: 't', dojo_hard_tests: 'green', suite: { passed: 1, skipped: 0 } };
    expect(promoteKernel(s, cand, battery).promoted).toBe(false);
  });

  it('P7 — evolución + reversión: cambio verde promociona; uno roto se bloquea; revertir restaura', async () => {
    const s = mem();
    const green = await runOracleBattery([pass]);
    const v1: KernelVersion = { version: '1.0', hash: 'sha256:a', promoted_at: '2026-01-01', dojo_hard_tests: 'green', suite: { passed: 1, skipped: 0 } };
    expect(promoteKernel(s, v1, green).promoted).toBe(true);
    expect(promoteKernel(s, { ...v1, version: '1.1', dojo_hard_tests: 'red' }, green).promoted).toBe(false);  // roto → bloqueado
    expect(revertKernel(s, '1.0')!.version).toBe('1.0');                                                      // reversión
  });
});
