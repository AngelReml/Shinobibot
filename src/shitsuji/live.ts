/**
 * shitsuji/live.ts — the LIVE wiring (⚑). Where the butler's injected seams stop
 * being placeholders and bind to the real subsystems:
 *
 *   - llmIntentParser  → COMPRENDER's parser, backed by the real provider router
 *     (invokeLLM, multi-provider failover). Utterance → {goals, references} JSON.
 *   - makeSandboxInvoke → T-08's skill invocation, backed by the real sandbox
 *     RunBackend (local cage execution). Runs the certified skill's command.
 *   - fsCopyInputs / makeFsCommit → T-08's copies/snapshots over REAL files: seed a
 *     copy of the user's input into the cage; commit a reversible result to the
 *     real destination, backing up what was there so uncommit restores it.
 *   - signTevChain / verifyTevSignature → the TEV's ed25519 signature (FASE D):
 *     each chained entry is signed, so a third party verifies the trace without
 *     trusting Shinobi.
 *
 * Every live dependency stays INJECTABLE (the LLM call, the backend) so this module
 * is testable without keys/containers; the defaults reach the real thing.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { invokeLLM } from '../providers/provider_router.js';
import { mediatedEffect } from '../sandbox/monitor.js';
import type { CloudResponse, LLMChatPayload } from '../cloud/types.js';
import type { NLParse, IntentParser } from './understand.js';
import type { SkillInvoker, SkillInvocation } from './runtime.js';
import type { PlanStep, TEVEntry } from './types.js';

// ── COMPRENDER: NL parser backed by the real LLM ────────────────────────────────

const PARSE_SYSTEM = [
  'Eres el módulo de COMPRENSIÓN de un mayordomo digital. Descompón la orden del usuario en',
  'objetivos atómicos y frases referenciales. Responde SOLO con JSON válido, sin prosa, con la forma:',
  '{"goals":[{"verb":"...","object":"...","constraints":["..."]}],',
  ' "references":[{"phrase":"...","kind":"app|file|folder|context","category":"design|office|dev|browser|media|finance|system|utility|other","query":"..."}]}',
  'kind=app lleva category; kind=file/folder lleva query; no inventes referencias que el usuario no nombró.',
].join('\n');

export interface LlmParserOptions {
  invoke?: (payload: LLMChatPayload, opts?: { provider?: any }) => Promise<CloudResponse>;
  model?: string;
}

/** Extract the first balanced JSON object from a model response (tolerant to prose/fences). */
export function extractJson(text: string): any {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('no JSON object in model output');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return JSON.parse(text.slice(start, i + 1)); }
  }
  throw new Error('unbalanced JSON object in model output');
}

/** ⚑ LIVE: COMPRENDER's parser via the real provider router (failover, multi-provider). */
export function llmIntentParser(opts: LlmParserOptions = {}): IntentParser {
  const invoke = opts.invoke ?? invokeLLM;
  return async (utterance: string): Promise<NLParse> => {
    const payload: LLMChatPayload = {
      messages: [{ role: 'system', content: PARSE_SYSTEM }, { role: 'user', content: utterance }],
      model: opts.model, temperature: 0,
    };
    const res = await invoke(payload);
    if (!res.success) throw new Error(`LLM parse failed: ${res.error}`);
    const obj = extractJson(typeof res.output === 'string' ? res.output : JSON.stringify(res.output));
    return {
      goals: Array.isArray(obj.goals) ? obj.goals : [],
      references: Array.isArray(obj.references) ? obj.references : [],
    };
  };
}

// ── T-08: skill invocation backed by the real sandbox backend ───────────────────

export interface SandboxInvokeOptions { backendId?: 'local' | 'docker' | 'ssh' | 'e2b' | 'mock'; timeoutMs?: number; }

/**
 * ⚑ LIVE: invoke a certified skill by running its rendered command (step.inputs.command)
 * in the cage workDir via the real sandbox RunBackend. The effect ceiling is still
 * enforced by the executor's Capa-2 state-diff afterwards.
 */
export function makeSandboxInvoke(opts: SandboxInvokeOptions = {}): SkillInvoker {
  return async (step: PlanStep, ctx: { workDir: string }): Promise<SkillInvocation> => {
    const command = String((step.inputs as any).command ?? '').trim();
    if (!command) return { success: false, output: `paso ${step.step_id} sin inputs.command para ejecutar`, tool: 'run_command' };
    // P1.E2 (plan de frontera): la skill certificada corre a través del Monitor
    // de Referencia, no del registry directo. `reversible: true` es la
    // declaración del caller: corre en la jaula (workDir) y el commit al mundo
    // real es reversible vía makeFsCommit (backup + uncommit).
    const res = await mediatedEffect({
      kind: 'shell',
      rawCommandLine: true,
      target: command,
      cwd: ctx.workDir,
      timeoutMs: opts.timeoutMs ?? 30_000,
      backendId: opts.backendId ?? 'local',
      reversible: true,
    });
    if (!res.ok) return { success: false, output: `backend ${opts.backendId ?? 'local'} no disponible`, tool: 'run_command' };
    const r = res.run;
    return {
      success: r.success,
      output: r.success ? r.stdout : `error: ${r.stderr}`,
      artifact: (step.inputs as any).artifact as string | undefined,
      claim: (step.inputs as any).claim as string | undefined,
      tool: 'run_command',
    };
  };
}

// ── T-08: real copies/snapshots over the user's files ───────────────────────────

/** ⚑ LIVE: seed a COPY of the user's real input into the cage (never the original). */
export function fsCopyInputs(step: PlanStep, workDir: string): void {
  const source = (step.inputs as any).source as string | undefined;
  if (!source) return;
  if (!fs.existsSync(source)) throw new Error(`entrada no encontrada: ${source}`);
  const destName = (step.inputs as any).as as string | undefined ?? path.basename(source);
  fs.copyFileSync(source, path.join(workDir, destName));
}

/**
 * ⚑ LIVE: commit/uncommit a REVERSIBLE result to the real world. commit copies the
 * cage artifact to step.inputs.dest, backing up any existing file so uncommit can
 * restore the prior state exactly (reversibility is what makes the commit safe).
 */
export function makeFsCommit() {
  const backups = new Map<string, string | null>();   // dest → backup path (or null if dest didn't exist)
  const commit = (step: PlanStep, workDir: string): void => {
    const dest = (step.inputs as any).dest as string | undefined;
    const artifact = ((step.inputs as any).artifact ?? (step.inputs as any).commit_artifact) as string | undefined;
    if (!dest || !artifact) return;                    // nothing to commit (skill produced no real-world output)
    const src = path.join(workDir, artifact);
    if (!fs.existsSync(src)) throw new Error(`artefacto a guardar no existe en la jaula: ${artifact}`);
    if (fs.existsSync(dest)) { const bak = `${dest}.shitsuji.bak`; fs.copyFileSync(dest, bak); backups.set(dest, bak); }
    else backups.set(dest, null);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  };
  const uncommit = (step: PlanStep): void => {
    const dest = (step.inputs as any).dest as string | undefined;
    if (!dest || !backups.has(dest)) return;
    const bak = backups.get(dest)!;
    if (bak === null) { if (fs.existsSync(dest)) fs.rmSync(dest); }   // dest didn't exist before → remove it
    else { fs.copyFileSync(bak, dest); fs.rmSync(bak); }              // restore the prior content
    backups.delete(dest);
  };
  return { commit, uncommit };
}

// ── TEV ed25519 signature (FASE D): a trace a third party verifies w/o trusting us ─

export interface SignedTEVEntry extends TEVEntry { signature: { alg: 'ed25519'; sig_hex: string; verifier_pubkey: string }; }
export interface Ed25519Keypair { publicKey: string; privateKey: string; }   // PEM

export function ed25519Keypair(): Ed25519Keypair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

/** Load the TEV keypair from a dir, creating it on first use (dir is .gitignored). */
export function loadOrCreateTevKeypair(dir: string): Ed25519Keypair {
  fs.mkdirSync(dir, { recursive: true });
  const pub = path.join(dir, 'tev_ed25519.pub.pem'), priv = path.join(dir, 'tev_ed25519.key.pem');
  if (fs.existsSync(pub) && fs.existsSync(priv)) return { publicKey: fs.readFileSync(pub, 'utf-8'), privateKey: fs.readFileSync(priv, 'utf-8') };
  const kp = ed25519Keypair();
  fs.writeFileSync(pub, kp.publicKey); fs.writeFileSync(priv, kp.privateKey);
  return kp;
}

/** Sign one TEV entry over its this_hash (binds the signature to the exact link). */
export function signTevEntry(e: TEVEntry, kp: Ed25519Keypair): SignedTEVEntry {
  const key = crypto.createPrivateKey(kp.privateKey);
  const sig_hex = crypto.sign(null, Buffer.from(e.this_hash, 'utf-8'), key).toString('hex');
  return { ...e, signature: { alg: 'ed25519', sig_hex, verifier_pubkey: kp.publicKey } };
}

export function signTevChain(entries: TEVEntry[], kp: Ed25519Keypair): SignedTEVEntry[] {
  return entries.map((e) => signTevEntry(e, kp));
}

/** Verify a signed entry's ed25519 signature against the embedded pubkey. */
export function verifyTevSignature(e: SignedTEVEntry): boolean {
  try {
    const key = crypto.createPublicKey(e.signature.verifier_pubkey);
    return crypto.verify(null, Buffer.from(e.this_hash, 'utf-8'), key, Buffer.from(e.signature.sig_hex, 'hex'));
  } catch { return false; }
}
