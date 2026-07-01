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
// ALTA-17: logueamos el fallo de carga UNA sola vez (no en cada llamada de un
// hot loop) — pero a diferencia de `_defaultsLoaded`, esta bandera NUNCA
// impide reintentar la carga real, solo evita inundar el log.
let _warnedOnce = false;

export function registerSkillForTool(toolName: string, binding: SkillBinding): void {
  REGISTRY.set(toolName, binding);
}

export function clearSkillRegistry(): void {
  REGISTRY.clear();
  _defaultsLoaded = false;
  _warnedOnce = false;
}

/**
 * Lazy, fail-soft load of the shipped certified skills (C7: fs.write.v1).
 *
 * ALTA-17 (auditoría 2026-06-30): antes, `_defaultsLoaded = true` se fijaba
 * ANTES de intentar la carga. Si el archivo certificado fallaba (ENOENT, JSON
 * malformado), la excepción se silenciaba en el catch y `_defaultsLoaded`
 * quedaba `true` para siempre — el registro permanecía vacío PERMANENTEMENTE
 * durante toda la sesión, sin ninguna alerta. Ahora `_defaultsLoaded` solo se
 * marca `true` DENTRO del try, justo tras el éxito real. Si el catch se
 * dispara, queda en `false` (cada llamada futura reintenta — el coste de un
 * `readFileSync` fallido es bajo) y se loguea un `console.warn` claro (una
 * sola vez, vía `_warnedOnce`, para no inundar un hot loop) para que el
 * fallo sea diagnosticable y nunca silencioso.
 */
function ensureDefaults(): void {
  if (_defaultsLoaded) return;
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
    _defaultsLoaded = true; // ← AHORA solo tras éxito real, no antes.
  } catch (e: any) {
    // fail-soft: si el certificado por defecto falta, los tools resuelven a
    // null (UNVERIFIED) — pero el fallo se reporta y se reintenta, nunca se
    // silencia para siempre.
    if (!_warnedOnce) {
      _warnedOnce = true;
      console.warn('[integrity/registry] no se pudo cargar el certificado por defecto fs.write.v1 — el registro de skills certificadas queda vacío hasta que se repare la fuente. Se reintentará en próximas llamadas.', e?.message ?? e);
    }
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
