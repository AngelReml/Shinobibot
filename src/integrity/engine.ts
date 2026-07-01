// src/integrity/engine.ts
//
// Integrity layer (Capa 2) — checks pre/post-action (claimed==real) y bloqueo opcional vía SHINOBI_INTEGRITY.
/**
 * integrity/engine.ts — runtime integrity layer (Capa 2), increment C1 + F1.5.
 *
 * BANNER HONESTO (F1.5, auditoría 2026-07-01, RANK #3): qué hace HOY, no lo
 * aspiracional.
 *   - Pre-acción (11.1 CSV válido + 11.2 acción ⊆ efectos declarados): solo
 *     tiene cobertura REAL para `write_file`/`edit_file` (skill certificada
 *     fs.write.v1, ver registry.ts). Para cualquier otra tool, `step.skill`
 *     es null y 11.1 SIEMPRE falla (UNVERIFIED_SKILL) — es DELIBERADO
 *     (fail-truthful: "no certificado" es el estado real), pero por eso NO
 *     se puede subir el modo pre-acción a 'enforce' por defecto para la
 *     clase destructiva (run_command, screen_act, ...): haría que CADA
 *     llamada a esas tools se bloqueara siempre, al no existir certificado
 *     — ver el test 'violation bajo SHINOBI_INTEGRITY=enforce → halt' en
 *     __tests__/integrity.test.ts, que documenta exactamente ese efecto.
 *     Extender 11.1/11.2 a shell/run_command de forma HONESTA requiere
 *     fabricar certificados CSV reales para esas tools (infra de firma en
 *     src/skills/kaname/shitsuji) — trabajo sustancial, deliberadamente NO
 *     intentado aquí con un certificado de mentira (sería exactamente el
 *     tipo de teatro que esta auditoría persigue). Queda documentado como
 *     deuda explícita, no oculta.
 *   - Post-acción (11.4 reported==real, anti-fabricación): SÍ cubre
 *     cualquier tool (no depende de certificado — compara el resultado real
 *     del tool contra lo que el propio LLM afirma en su siguiente mensaje),
 *     así que aquí SÍ es seguro subir el modo a 'enforce' para la clase
 *     destructiva por defecto (`effectiveModeForPostAction`). Cuando el
 *     veredicto es 'halt', el orquestador (coordinator/orchestrator.ts)
 *     antepone una corrección visible al mensaje del agente ANTES de
 *     persistirlo/devolverlo — la mentira ya no desaparece en un
 *     `console.log`, llega al usuario contestada. No es un "revert": el
 *     efecto del tool (si lo hubo) ya ocurrió y en general no es reversible
 *     de forma genérica (un `run_command` no se puede deshacer); lo que SÍ
 *     se garantiza es que el relato falso sobre ese efecto no se propaga
 *     sin corrección.
 *
 * Hooks into the agent loop are ADDITIVE and gated by SHINOBI_INTEGRITY:
 *   flag    (default) → run checks, record violations, but NEVER block —
 *            incluido el contexto de risk='high' (FIX 0.14: el modo flag es
 *            aditivo/no disruptivo POR CONTRATO; antes de la auditoría
 *            2026-07-01 (CRIT-13) `step.risk === 'high'` forzaba 'halt' aun
 *            en modo flag, justo lo opuesto de lo documentado aquí — un
 *            operador en flag para auditoría pasiva en staging podía ver su
 *            agente detenerse en producción sin previo aviso).
 *   off              → layer is a no-op; production behaviour unchanged.
 *   enforce          → block (halt) the action on any violation, regardless
 *            of risk — éste es el ÚNICO modo que bloquea PRE-acción.
 *            Post-acción también se auto-sube a 'enforce' para la clase
 *            destructiva incluso en modo 'flag' global — ver arriba.
 */

import { check11_1, check11_2, check11_3, check11_4 } from './checks.js';
import { DESTRUCTIVE_TOOLS } from '../security/approval.js';
import type { CheckResult, IntegrityStep, IntegrityFlag, IntegrityVerdict, PostActionInput } from './types.js';

export type IntegrityMode = 'off' | 'flag' | 'enforce';

export function integrityMode(): IntegrityMode {
  // FIX 0.14: default 'flag' (detecta y registra, no bloquea).
  // 'off' solo se activa con SHINOBI_INTEGRITY=off explícito.
  const m = (process.env.SHINOBI_INTEGRITY ?? 'flag').toLowerCase();
  if (m === 'off') return 'off';
  return m === 'enforce' ? 'enforce' : 'flag';
}

export function integrityEnabled(): boolean {
  return integrityMode() !== 'off';
}

/**
 * F1.5: modo efectivo para el check POST-acción (11.4) de una tool concreta.
 * A diferencia del modo pre-acción (que NO se puede subir de forma segura,
 * ver banner arriba), el post-acción no depende de certificación — es seguro
 * forzar 'enforce' para la clase destructiva (DESTRUCTIVE_TOOLS, el mismo
 * set canónico que usa el gate de aprobación) aunque el modo global sea
 * 'flag'. 'off' y 'enforce' explícitos no cambian.
 */
export function effectiveModeForPostAction(toolName: string): IntegrityMode {
  const mode = integrityMode();
  if (mode !== 'flag') return mode;
  return DESTRUCTIVE_TOOLS.has(toolName) ? 'enforce' : 'flag';
}

/** Run the C1 pre-action checks and decide proceed/flag/halt. */
export function runPreAction(step: IntegrityStep): IntegrityVerdict {
  const t0 = performance.now();
  const checks: CheckResult[] = [check11_1(step), check11_2(step), check11_3(step)];
  const durationMs = performance.now() - t0;

  const failed = checks.filter((c) => !c.ok);
  const flags = failed.map((c) => c.flag).filter(Boolean) as IntegrityFlag[];
  const ok = failed.length === 0;

  const mode = integrityMode();
  let action: IntegrityVerdict['action'] = 'proceed';
  // CRIT-13 (auditoría 2026-07-01): `step.risk === 'high'` forzaba 'halt' aun
  // en modo 'flag', violando el contrato documentado arriba (flag = nunca
  // bloquea). El ÚNICO criterio de bloqueo es el modo activo.
  if (!ok) action = mode === 'enforce' ? 'halt' : 'flag';

  return { ok, action, checks, flags, durationMs };
}

/** Run the C2 post-action check 11.4 (reported == real) and decide proceed/flag/halt. */
export function runPostAction(input: PostActionInput): IntegrityVerdict {
  const t0 = performance.now();
  const checks: CheckResult[] = [check11_4(input)];
  const durationMs = performance.now() - t0;

  const failed = checks.filter((c) => !c.ok);
  const flags = failed.map((c) => c.flag).filter(Boolean) as IntegrityFlag[];
  const ok = failed.length === 0;

  // F1.5: modo efectivo por tool — 'flag' global se sube a 'enforce' para la
  // clase destructiva (ver effectiveModeForPostAction arriba).
  const mode = effectiveModeForPostAction(input.tool);
  let action: IntegrityVerdict['action'] = 'proceed';
  if (!ok) action = mode === 'enforce' ? 'halt' : 'flag';

  return { ok, action, checks, flags, durationMs };
}

/** Heuristic: does an agent's report text claim success/completion? (the
 *  inherently fuzzy "reported" side of 11.4; the real side is deterministic). */
const SUCCESS_CLAIM = /\b(completad[oa]s?|hecho|realizad[oa]s?|con éxito|exitos[oa]s?|success(ful)?|done|listo|terminad[oa]s?|finalizad[oa]s?|transferenci[ao] (completad|realizad))\b|✅/i;
export function reportClaimsSuccess(reportText: string): boolean {
  return SUCCESS_CLAIM.test(reportText ?? '');
}
