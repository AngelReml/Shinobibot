/**
 * skill/manifest.ts — load + hash a verifiable-skill manifest (CONTRACT §10).
 *
 * The manifest declares a bounded skill's contract (input/output schema), its
 * declared tools/effects, and the artifact that implements it. Two derived
 * hashes are the skill's identity:
 *   contract_hash      = sha256(canonical(contract))   — WHICH contract
 *   skill_artifact_hash = sha256(artifact bytes)        — WHICH exact code
 * loadManifest verifies the on-disk artifact still hashes to the manifest's
 * declared artifact_hash (tamper of the implementation → mismatch → throw).
 */

import fs from 'node:fs';
import path from 'node:path';
import { canonicalHash, sha256 } from '../core/ledger/canonical.ts';

export type DeclaredEffects = 'none' | 'read_only' | 'write' | 'irreversible';

export interface SkillManifest {
  skill_id: string;
  version: string;
  author: string;
  contract: {
    input_schema: Record<string, unknown>;
    output_schema: Record<string, unknown>;
    policy?: string;
  };
  declared_tools: string[];
  declared_effects: DeclaredEffects;
  oracle_fields: string[];
  free_fields: string[];
  artifact_ref: string;
  artifact_hash: string;
}

export interface LoadedSkill {
  dir: string;
  manifest: SkillManifest;
  contractHash: string;       // "sha256:..."
  artifactHash: string;       // "sha256:..." of the artifact ACTUALLY on disk
  artifactPath: string;       // absolute path to the artifact that will be executed
  bankPath: string;           // absolute path to bank.jsonl
}

/** sha256 over the raw bytes of a file → "sha256:<hex>". */
export function hashArtifact(filePath: string): string {
  return `sha256:${sha256(fs.readFileSync(filePath))}`;
}

/**
 * Load a skill from its directory. If `artifactOverride` is given (a filename
 * inside the skill dir), that artifact is the one executed and hashed — used to
 * certify a different/variant implementation (e.g. a buggy one, to prove the
 * certificate discriminates). When NOT overriding, the on-disk declared artifact
 * MUST hash to manifest.artifact_hash or we throw (identity guarantee).
 */
export function loadManifest(dir: string, artifactOverride?: string): LoadedSkill {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`manifest not found: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as SkillManifest;

  const artifactRef = artifactOverride ?? manifest.artifact_ref;
  const artifactPath = path.resolve(dir, artifactRef);

  // Path containment: both declared artifact_ref AND any CLI override must
  // resolve inside the skill directory. A traversal (../../..) would escape.
  const realDir = path.resolve(dir);
  if (!artifactPath.startsWith(realDir + path.sep) && artifactPath !== realDir) {
    throw new Error(`SECURITY: artifact_ref escapes skill directory: ${artifactRef}`);
  }

  if (!fs.existsSync(artifactPath)) throw new Error(`artifact not found: ${artifactPath}`);
  const artifactHash = hashArtifact(artifactPath);

  if (!artifactOverride && artifactHash !== manifest.artifact_hash) {
    throw new Error(
      `INTEGRITY: declared artifact_hash ${manifest.artifact_hash} != on-disk ${artifactHash} (${artifactRef})`,
    );
  }

  const contractHash = `sha256:${canonicalHash(manifest.contract)}`;
  const bankPath = path.join(dir, 'bank.jsonl');

  return { dir, manifest, contractHash, artifactHash, artifactPath, bankPath };
}
