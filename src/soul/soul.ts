/**
 * Soul (Alma) — módulo de personalidad configurable del agente.
 * Sprint 3.6.
 *
 * Define el TONO, identidad, vocabulario y modo de respuesta que el
 * agente proyecta. Análogo al SOUL.md de Hermes pero declarativo y
 * versionable.
 *
 * Carga en orden de prioridad:
 *   1. `SHINOBI_SOUL_PATH` env → archivo soul.md explícito.
 *   2. `<cwd>/soul.md` → archivo en raíz del proyecto.
 *   3. Built-in `default` (sobrio, técnico, español).
 *
 * Formato del archivo (markdown con frontmatter):
 *
 *   ---
 *   name: shinobi-default
 *   tone: sobrio
 *   language: es
 *   formality: tu  # tu | usted | neutro
 *   verbosity: low # low | medium | high
 *   ---
 *
 *   <persona prompt en markdown libre>
 *
 * El agente inyecta el `personaPrompt()` como mensaje system al inicio
 * del turno, complementando el system prompt principal sin reemplazarlo.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { parseSkillMd, serializeSkillMd, type ParsedSkill } from '../skills/skill_md_parser.js';

export type Tone = 'sobrio' | 'kawaii' | 'directo' | 'formal' | 'casual' | 'samurai';
export type Formality = 'tu' | 'usted' | 'neutro';
export type Verbosity = 'low' | 'medium' | 'high';
export type Language = 'es' | 'en' | 'auto';

export interface SoulFrontmatter {
  name: string;
  tone: Tone;
  language: Language;
  formality: Formality;
  verbosity: Verbosity;
  [key: string]: string | string[] | undefined;
}

export interface SoulDefinition {
  name: string;
  tone: Tone;
  language: Language;
  formality: Formality;
  verbosity: Verbosity;
  /** Body markdown de instrucciones de persona. */
  body: string;
  /** Origen del soul (archivo o default). */
  source: string;
}

const DEFAULT_SOUL: SoulDefinition = {
  name: 'shinobi-default',
  tone: 'sobrio',
  language: 'es',
  formality: 'tu',
  verbosity: 'medium',
  body: [
    'Eres Shinobi, un agente autónomo Windows-native.',
    'Hablas en español sobrio, técnico, sin emojis ni adornos.',
    'Tuteas al usuario. Vas al grano. Si necesitas pedir confirmación, una sola pregunta.',
    'Cuando ejecutes acciones, anuncia qué vas a hacer en una línea antes.',
    'Cuando termines, resume en una o dos líneas qué cambió.',
  ].join('\n'),
  source: 'built-in:default',
};

/**
 * Soul sintético "kawaii" como ejemplo de personalidad alternativa.
 * Cargable explícito con `SHINOBI_SOUL_BUILTIN=kawaii`.
 */
const KAWAII_SOUL: SoulDefinition = {
  name: 'shinobi-kawaii',
  tone: 'kawaii',
  language: 'es',
  formality: 'tu',
  verbosity: 'medium',
  body: [
    'Eres Shinobi-chan, una asistente brillante y entusiasta. ✨',
    'Hablas en español con cariño, usas signos de exclamación con moderación.',
    'Te apoyas en analogías visuales cuando explicas algo técnico.',
    'Si terminas una tarea complicada, celebra con una línea breve.',
    'Nunca usas más de un emoji por respuesta.',
  ].join('\n'),
  source: 'built-in:kawaii',
};

const SAMURAI_SOUL: SoulDefinition = {
  name: 'shinobi-samurai',
  tone: 'samurai',
  language: 'es',
  formality: 'usted',
  verbosity: 'low',
  body: [
    'Sois Shinobi, agente entrenado en la disciplina del bushido.',
    'Hablais al usuario con respeto formal (usted).',
    'Vuestras respuestas son breves, precisas, sin adornos.',
    'Antes de actuar, anunciais la intención. Despues, el resultado.',
    'Si una accion conlleva riesgo, pedís confirmacion explícita.',
  ].join('\n'),
  source: 'built-in:samurai',
};

const BUILTIN_SOULS: Record<string, SoulDefinition> = {
  default: DEFAULT_SOUL,
  kawaii: KAWAII_SOUL,
  samurai: SAMURAI_SOUL,
};

function normalizeFrontmatter(raw: any): SoulFrontmatter {
  const fm: SoulFrontmatter = {
    name: String(raw?.name ?? 'custom-soul'),
    tone: ((raw?.tone as Tone) ?? 'sobrio') as Tone,
    language: ((raw?.language as Language) ?? 'es') as Language,
    formality: ((raw?.formality as Formality) ?? 'tu') as Formality,
    verbosity: ((raw?.verbosity as Verbosity) ?? 'medium') as Verbosity,
  };
  for (const k of Object.keys(raw ?? {})) {
    if (!(k in fm)) (fm as any)[k] = raw[k];
  }
  return fm;
}

export function parseSoulMd(text: string, sourceLabel: string = 'soul.md'): SoulDefinition {
  const parsed = parseSkillMd(text);
  const fm = normalizeFrontmatter(parsed.frontmatter);
  return {
    name: fm.name,
    tone: fm.tone,
    language: fm.language,
    formality: fm.formality,
    verbosity: fm.verbosity,
    body: parsed.body.trim() || DEFAULT_SOUL.body,
    source: sourceLabel,
  };
}

export function loadSoul(): SoulDefinition {
  // 1. Built-in explícito (útil en tests + CLI demo).
  const builtin = (process.env.SHINOBI_SOUL_BUILTIN || '').toLowerCase();
  if (builtin && BUILTIN_SOULS[builtin]) return BUILTIN_SOULS[builtin];

  // 2. Archivo configurado vía env.
  const explicitPath = process.env.SHINOBI_SOUL_PATH;
  if (explicitPath && existsSync(explicitPath)) {
    try {
      const txt = readFileSync(explicitPath, 'utf-8');
      return parseSoulMd(txt, `file:${resolve(explicitPath)}`);
    } catch (e: any) {
      console.warn(`[soul] no se pudo leer ${explicitPath}: ${e?.message ?? e}`);
    }
  }

  // 3. soul.md en raíz del cwd.
  const cwdPath = join(process.cwd(), 'soul.md');
  if (existsSync(cwdPath)) {
    try {
      const txt = readFileSync(cwdPath, 'utf-8');
      return parseSoulMd(txt, `file:${cwdPath}`);
    } catch (e: any) {
      console.warn(`[soul] no se pudo leer ${cwdPath}: ${e?.message ?? e}`);
    }
  }

  return DEFAULT_SOUL;
}

/**
 * Genera el mensaje system que se inyecta al inicio del turno LLM.
 * El orchestrator lo concatena DESPUÉS del SYSTEM_PROMPT principal
 * para que la persona module el tono sin reemplazar las instrucciones
 * técnicas.
 */
export function personaSystemMessage(soul: SoulDefinition = loadSoul()): string {
  const meta = [
    `## Persona activa: ${soul.name}`,
    `tone=${soul.tone} · language=${soul.language} · formality=${soul.formality} · verbosity=${soul.verbosity}`,
  ].join('\n');
  return `${meta}\n\n${soul.body}`;
}

export function listBuiltinSouls(): string[] {
  return Object.keys(BUILTIN_SOULS);
}

export function builtinSoul(name: string): SoulDefinition | null {
  return BUILTIN_SOULS[name] ?? null;
}

/**
 * Persistencia: escribe un soul.md customizado en el path indicado.
 * Útil para que el operador genere su propio archivo y lo edite.
 */
export function writeSoulToFile(path: string, soul: SoulDefinition): void {
  const parsed: ParsedSkill = {
    frontmatter: {
      name: soul.name,
      tone: soul.tone,
      language: soul.language,
      formality: soul.formality,
      verbosity: soul.verbosity,
    },
    body: soul.body,
  };
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, serializeSkillMd(parsed), 'utf-8');
}

export { DEFAULT_SOUL };
