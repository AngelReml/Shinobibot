/**
 * integrity/registry.ts — maps a Shinobi tool name → the certified SkillBinding
 * that backs it, and builds the IntegrityStep for a tool call.
 *
 * C7: the first REAL binding lands here — write_file / edit_file are governed by
 * the certified fs.write.v1 policy (a CERTIFIED CSV shipped under certified/).
 * The protected-path policy that the approval gate enforces is expressed as this
 * skill's declared_effects scope (effect_scope.deny_protected), so it is one
 * policy, not two. Tools without a binding resolve to null → 11.1 flags them
 * UNVERIFIED (truthful — not yet certified).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IntegrityStep, SkillBinding } from './types.js';

const REGISTRY = new Map<string, SkillBinding>();
let _defaultsLoaded = false;

export function registerSkillForTool(toolName: string, binding: SkillBinding): void {
  REGISTRY.set(toolName, binding);
}

export function clearSkillRegistry(): void {
  REGISTRY.clear();
  _defaultsLoaded = false;
}

/** Lazy, fail-soft load of the shipped certified skills (C7: fs.write.v1). */
function ensureDefaults(): void {
  if (_defaultsLoaded) return;
  _defaultsLoaded = true;
  try {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'certified', 'fs.write.v1');
    const csv = JSON.parse(fs.readFileSync(path.join(dir, 'certificate.csv.json'), 'utf-8'));
    const binding: SkillBinding = {
      skill_id: 'fs.write.v1',
      declared_tools: ['write_file', 'edit_file'],
      declared_effects: 'write',
      csv,
      artifact_path: path.join(dir, 'skill.mjs'),
      effect_scope: { deny_protected: true },
    };
    REGISTRY.set('write_file', binding);
    REGISTRY.set('edit_file', binding);
  } catch {
    /* fail-soft: if the certified skill is missing, tools resolve to null (UNVERIFIED) */
  }
}

export function resolveSkillBinding(toolName: string): SkillBinding | null {
  ensureDefaults();
  return REGISTRY.get(toolName) ?? null;
}

/** Build the IntegrityStep for a tool call about to run.
 *  `outOfScope` is the single protected-path verdict (approval.classifyCritical),
 *  passed in by the orchestrator so 11.2 enforces ONE policy. */
export function stepForToolCall(toolName: string, args: unknown, opts: { risk?: 'low' | 'high'; outOfScope?: boolean } = {}): IntegrityStep {
  return {
    step: 0,
    action: { tool: toolName, args, out_of_scope: opts.outOfScope },
    skill: resolveSkillBinding(toolName),
    risk: opts.risk ?? 'low',
  };
}
