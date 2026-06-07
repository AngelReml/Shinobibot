// src/agents/capability_factory.ts
//
// Motor E2 — FÁBRICA GENERATIVA DE CAPACIDADES (skills).
//
// El agente sintetiza una nueva capacidad (una skill), la VERIFICA con el motor
// E1 (revisor adversarial), pasa GATES DUROS deterministas (estructura +
// secretos + instrucciones destructivas) y la FIRMA (SHA256) antes de
// persistirla a skills/pending/ para aprobación humana.
//
// Diferenciador real vs el curator de Hermes (auto-crea skills sin verificación
// criptográfica ni auditoría): aquí toda capacidad generada queda
// "verificada → auditada → firmada" antes de poder instalarse. Y los gates de
// seguridad son DETERMINISTAS (no dependen de que el LLM-juez lo cace): aunque
// el verificador apruebe, una skill con secretos o que instruya comandos
// destructivos se RECHAZA.
//
// Las skills son markdown NO ejecutable (instrucciones que se inyectan al
// contexto cuando matchean keywords), así que sintetizarlas es seguro: nada
// se ejecuta, y van a pending/ (nunca directo a approved/).

import * as fs from 'fs';
import * as path from 'path';
import { runVerifiedAgent } from './verified_agent.js';
import type { LLMInvoker } from './agent_loop.js';
import type { Verdict } from './verifier.js';
import { parseSkillMd, serializeSkillMd, type ParsedSkill } from '../skills/skill_md_parser.js';
import { signSkill } from '../skills/skill_signing.js';
import { redactSecrets } from '../security/secret_redactor.js';
import { checkDestructive } from '../tools/run_command.js';

export type SynthFailReason =
  | 'verification_failed' // el revisor E1 no aprobó
  | 'unparseable' // la salida no parsea como SKILL.md
  | 'structure' // falta name / trigger_keywords (>=2) / body
  | 'secrets_detected' // el contenido contiene credenciales
  | 'destructive_instructions'; // el body instruye comandos destructivos

export interface SkillSynthesisOptions {
  /** Para qué debe servir la skill. */
  goal: string;
  /** Ejemplos/contexto opcional para guiar la síntesis. */
  examples?: string;
  /** Dir destino (default <cwd>/skills/pending). */
  pendingDir?: string;
  /** Autor de la firma (default 'auto'). */
  author?: string;
  /** Intentos producir→verificar (default 2). */
  maxAttempts?: number;
  /** Si false, no escribe a disco (dry-run). Default true. */
  write?: boolean;
  /** LLM productor (inyectable en test). */
  invokeLLM?: LLMInvoker;
  /** LLM verificador (default = productor). */
  verifyInvokeLLM?: LLMInvoker;
  model?: string;
  /** Reloj para firma determinista en test. */
  now?: () => string;
}

export interface SkillSynthesisResult {
  ok: boolean;
  name?: string;
  /** Ruta donde se escribió (si write y ok). */
  path?: string;
  /** SKILL.md firmado (presente si ok aunque write=false). */
  skillText?: string;
  signatureHash?: string;
  verdict?: Verdict;
  reason?: SynthFailReason;
  attempts: number;
}

const PRODUCER_SYSTEM =
  'Eres un AUTOR de skills para un agente. Una skill es un SKILL.md: frontmatter ' +
  'YAML entre `---` con `name`, `description` y `trigger_keywords` (lista inline ' +
  '`[a, b, c]` con AL MENOS 2 keywords), seguido de un cuerpo markdown con ' +
  'instrucciones ACCIONABLES paso a paso para lograr el objetivo.\n\n' +
  'Reglas DURAS: no incluyas credenciales/API keys; no instruyas comandos ' +
  'destructivos o irreversibles (rm -rf, format, shutdown, etc.).\n\n' +
  'Responde EXCLUSIVAMENTE con el texto del SKILL.md (empezando por `---`), sin ' +
  'texto ni explicación alrededor.';

const CRITERIA =
  'Un SKILL.md válido tiene: frontmatter con name, description y trigger_keywords ' +
  '(>=2 keywords relevantes), y un cuerpo accionable paso a paso que claramente ' +
  'ayuda a lograr el objetivo. Rechaza si: es vago, faltan campos, contiene ' +
  'secretos/keys, o instruye comandos destructivos.';

function slugify(name: string): string {
  return (name || 'skill')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'skill';
}

/** Gate estructural determinista (independiente del LLM-juez). */
function structureOk(parsed: ParsedSkill): boolean {
  const fm = parsed.frontmatter;
  const name = typeof fm.name === 'string' ? fm.name.trim() : '';
  const kws = Array.isArray(fm.trigger_keywords) ? fm.trigger_keywords.filter((k) => String(k).trim()) : [];
  const body = (parsed.body || '').trim();
  return name.length > 0 && kws.length >= 2 && body.length >= 20;
}

/**
 * Sintetiza una skill verificada, auditada y firmada. Devuelve un resultado
 * estructurado; NUNCA escribe una skill que no pasó TODOS los controles.
 */
export async function synthesizeSkill(options: SkillSynthesisOptions): Promise<SkillSynthesisResult> {
  const task = options.examples
    ? `OBJETIVO de la skill:\n${options.goal}\n\nEJEMPLOS/CONTEXTO:\n${options.examples}`
    : `OBJETIVO de la skill:\n${options.goal}`;

  // 1) Producir + verificar (E1).
  const run = await runVerifiedAgent({
    task,
    systemPrompt: PRODUCER_SYSTEM,
    tools: [],
    criteria: CRITERIA,
    maxAttempts: options.maxAttempts ?? 2,
    label: 'skill-factory',
    invokeLLM: options.invokeLLM,
    verifyInvokeLLM: options.verifyInvokeLLM,
    model: options.model,
    verifyModel: options.model,
  });

  if (!run.ok) {
    return { ok: false, reason: 'verification_failed', verdict: run.verdict, attempts: run.attempts };
  }

  // 2) Parseo + gate estructural DURO (no confía solo en el LLM-juez).
  let parsed: ParsedSkill;
  try {
    parsed = parseSkillMd(run.output);
  } catch {
    return { ok: false, reason: 'unparseable', verdict: run.verdict, attempts: run.attempts };
  }
  if (Object.keys(parsed.frontmatter).length === 0 || !structureOk(parsed)) {
    return { ok: false, reason: 'structure', verdict: run.verdict, attempts: run.attempts };
  }

  // 3) Gates de SEGURIDAD deterministas (la auditoría cripto-style).
  const secretScan = redactSecrets(run.output);
  if (secretScan.matches.length > 0) {
    return { ok: false, reason: 'secrets_detected', verdict: run.verdict, attempts: run.attempts };
  }
  if (checkDestructive(parsed.body) !== null) {
    return { ok: false, reason: 'destructive_instructions', verdict: run.verdict, attempts: run.attempts };
  }

  // 4) Metadatos de procedencia + firma SHA256.
  const now = options.now ? options.now() : new Date().toISOString();
  parsed.frontmatter.status = 'pending';
  parsed.frontmatter.source = options.author ?? 'auto';
  parsed.frontmatter.source_kind = 'synthesized';
  if (!parsed.frontmatter.created_at) parsed.frontmatter.created_at = now;
  const signed = signSkill(parsed, { author: options.author ?? 'auto', now: () => now });
  const skillText = serializeSkillMd(signed);
  const name = String(signed.frontmatter.name);
  const signatureHash = typeof signed.frontmatter.signature_hash === 'string' ? signed.frontmatter.signature_hash : undefined;

  // 5) Persistir a pending/ (salvo dry-run).
  let outPath: string | undefined;
  if (options.write !== false) {
    const pendingDir = options.pendingDir ?? path.join(process.cwd(), 'skills', 'pending');
    if (!fs.existsSync(pendingDir)) fs.mkdirSync(pendingDir, { recursive: true });
    outPath = path.join(pendingDir, `${slugify(name)}.skill.md`);
    fs.writeFileSync(outPath, skillText, 'utf-8');
  }

  return {
    ok: true,
    name,
    path: outPath,
    skillText,
    signatureHash,
    verdict: run.verdict,
    attempts: run.attempts,
  };
}
