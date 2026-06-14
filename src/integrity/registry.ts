/**
 * integrity/registry.ts — maps a Shinobi tool name → the certified SkillBinding
 * that backs it, and builds the IntegrityStep for a tool call.
 *
 * In increment C1 this registry is EMPTY by default: production tools are not yet
 * bound to certified skills, so a tool call resolves to skill=null and 11.1 flags
 * it UNVERIFIED (truthful — nothing is certified yet). Binding tools to skills is
 * a later increment; the demo/tests populate it explicitly to exercise the checks.
 */

import type { IntegrityStep, SkillBinding } from './types.js';

const REGISTRY = new Map<string, SkillBinding>();

export function registerSkillForTool(toolName: string, binding: SkillBinding): void {
  REGISTRY.set(toolName, binding);
}

export function resolveSkillBinding(toolName: string): SkillBinding | null {
  return REGISTRY.get(toolName) ?? null;
}

export function clearSkillRegistry(): void {
  REGISTRY.clear();
}

/** Build the IntegrityStep for a tool call about to run. */
export function stepForToolCall(toolName: string, args: unknown, risk: 'low' | 'high' = 'low'): IntegrityStep {
  return { step: 0, action: { tool: toolName, args }, skill: resolveSkillBinding(toolName), risk };
}
