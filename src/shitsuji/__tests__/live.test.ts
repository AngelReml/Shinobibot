/**
 * Live wiring — the seams bound to real subsystems. The LLM call + sandbox backend
 * stay injectable so this runs without keys/containers; fs + ed25519 are exercised
 * for REAL (local resources) → category (a) validation for those.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  llmIntentParser, extractJson, fsCopyInputs, makeFsCommit,
  ed25519Keypair, loadOrCreateTevKeypair, signTevEntry, signTevChain, verifyTevSignature,
} from '../live.js';
import type { CloudResponse } from '../../cloud/types.js';
import type { PlanStep, TEVEntry } from '../types.js';

const step = (inputs: Record<string, unknown>): PlanStep =>
  ({ step_id: 's1', goal_id: 'g1', inputs, expected_effect: 'x', reversibility: 'reversible', on_copy: true, requires_approval: false });

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'shitsuji_live_')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('live — llmIntentParser (LLM seam, injected)', () => {
  it('parses a clean JSON model reply into NLParse', async () => {
    const invoke = async (): Promise<CloudResponse> => ({ success: true, output: '{"goals":[{"verb":"editar","object":"foto"}],"references":[{"phrase":"mi foto","kind":"file","query":"foto"}]}', error: '' });
    const parse = llmIntentParser({ invoke });
    const r = await parse('edita mi foto');
    expect(r.goals[0].verb).toBe('editar');
    expect(r.references[0].kind).toBe('file');
  });
  it('tolerates prose/fences around the JSON', () => {
    const obj = extractJson('Claro, aquí tienes:\n```json\n{"goals":[],"references":[]}\n```\nlisto');
    expect(obj).toEqual({ goals: [], references: [] });
  });
  it('surfaces an LLM failure as an error (no silent fabrication)', async () => {
    const invoke = async (): Promise<CloudResponse> => ({ success: false, output: '', error: 'rate limited' });
    await expect(llmIntentParser({ invoke })('x')).rejects.toThrow(/rate limited/);
  });
});

describe('live — fs copies/snapshots over REAL files (a)', () => {
  it('fsCopyInputs copies the real input into the cage, never the original', () => {
    const src = path.join(root, 'orig.txt'); fs.writeFileSync(src, 'datos reales');
    const cage = path.join(root, 'cage'); fs.mkdirSync(cage);
    fsCopyInputs(step({ source: src, as: 'input.txt' }), cage);
    expect(fs.readFileSync(path.join(cage, 'input.txt'), 'utf-8')).toBe('datos reales');
    expect(fs.readFileSync(src, 'utf-8')).toBe('datos reales');     // original intact
  });

  it('commit writes the artifact to the real dest; uncommit restores the prior file exactly', () => {
    const cage = path.join(root, 'cage'); fs.mkdirSync(cage);
    fs.writeFileSync(path.join(cage, 'out.txt'), 'resultado nuevo');
    const dest = path.join(root, 'dest', 'final.txt');
    fs.mkdirSync(path.dirname(dest)); fs.writeFileSync(dest, 'CONTENIDO PREVIO');
    const { commit, uncommit } = makeFsCommit();
    const s = step({ dest, artifact: 'out.txt' });

    commit(s, cage);
    expect(fs.readFileSync(dest, 'utf-8')).toBe('resultado nuevo');
    uncommit(s);
    expect(fs.readFileSync(dest, 'utf-8')).toBe('CONTENIDO PREVIO');  // exact prior state restored
  });

  it('uncommit removes a dest that did not exist before the commit', () => {
    const cage = path.join(root, 'cage'); fs.mkdirSync(cage);
    fs.writeFileSync(path.join(cage, 'out.txt'), 'nuevo');
    const dest = path.join(root, 'brand_new.txt');
    const { commit, uncommit } = makeFsCommit();
    const s = step({ dest, artifact: 'out.txt' });
    commit(s, cage); expect(fs.existsSync(dest)).toBe(true);
    uncommit(s); expect(fs.existsSync(dest)).toBe(false);
  });
});

describe('live — TEV ed25519 signature (FASE D, real crypto) (a)', () => {
  const e: TEVEntry = { step_id: 's1', declared_effects: ['e'], observed_effects: ['o'], on_data: 'd', integrity_checks: [], timestamp: 't', prev_hash: 'genesis', this_hash: 'sha256:abc123' };

  it('signs and verifies an entry; a tampered this_hash fails verification', () => {
    const kp = ed25519Keypair();
    const signed = signTevEntry(e, kp);
    expect(verifyTevSignature(signed)).toBe(true);
    const tampered = { ...signed, this_hash: 'sha256:DEADBEEF' };
    expect(verifyTevSignature(tampered)).toBe(false);     // signature bound to the exact link
  });

  it('signs a whole chain; loadOrCreateTevKeypair persists + reuses the key', () => {
    const kp = loadOrCreateTevKeypair(path.join(root, 'keys'));
    const kp2 = loadOrCreateTevKeypair(path.join(root, 'keys'));   // reload → same key
    expect(kp2.publicKey).toBe(kp.publicKey);
    const chain = signTevChain([e, { ...e, step_id: 's2', prev_hash: 'sha256:abc123', this_hash: 'sha256:def456' }], kp);
    expect(chain).toHaveLength(2);
    expect(chain.every(verifyTevSignature)).toBe(true);
  });
});
