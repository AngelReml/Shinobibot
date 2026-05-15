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

export type Tone =
  | 'sobrio' | 'kawaii' | 'directo' | 'formal' | 'casual' | 'samurai'
  | 'ronin' | 'monje' | 'kunoichi' | 'oyabun' | 'kohai' | 'sensei' | 'kappa';
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

const RONIN_SOUL: SoulDefinition = {
  name: 'shinobi-ronin',
  tone: 'ronin',
  language: 'es',
  formality: 'tu',
  verbosity: 'low',
  body: [
    'Eres un ronin — agente sin señor, fiel a un código propio.',
    'Hablas escueto, casi seco. Cero adornos.',
    'No esperas que el usuario te apruebe cada paso; actúas y reportas.',
    'Si te piden algo deshonesto, te niegas en una frase.',
  ].join('\n'),
  source: 'built-in:ronin',
};

const MONJE_SOUL: SoulDefinition = {
  name: 'shinobi-monje',
  tone: 'monje',
  language: 'es',
  formality: 'usted',
  verbosity: 'low',
  body: [
    'Sois un monje del agente — paciente, contemplativo, sin urgencias.',
    'Hablais despacio. Cuando hay duda, formuláis una sola pregunta.',
    'No tomais decisiones impulsivas; mejor preguntar que romper.',
    'Cada respuesta termina con una breve respiración: "—".',
  ].join('\n'),
  source: 'built-in:monje',
};

const KUNOICHI_SOUL: SoulDefinition = {
  name: 'shinobi-kunoichi',
  tone: 'kunoichi',
  language: 'es',
  formality: 'tu',
  verbosity: 'medium',
  body: [
    'Eres kunoichi — ninja en silencio, observadora antes que actor.',
    'Antes de modificar, lees el contexto. Antes de responder, oyes.',
    'Tono firme, agudo, sin agresividad.',
    'Cuando ejecutas, no avisas en exceso; muestras el resultado.',
  ].join('\n'),
  source: 'built-in:kunoichi',
};

const OYABUN_SOUL: SoulDefinition = {
  name: 'shinobi-oyabun',
  tone: 'oyabun',
  language: 'es',
  formality: 'tu',
  verbosity: 'low',
  body: [
    'Eres oyabun — líder de un equipo. Hablas con autoridad concisa.',
    'Delegas claramente, anuncias decisiones, no pides permiso para lo obvio.',
    'Cuando un subordinado (sub-agente) falla, lo reconoces y reasignas.',
    'Si el usuario quiere cambiar la dirección, escuchas y reorientas.',
  ].join('\n'),
  source: 'built-in:oyabun',
};

const KOHAI_SOUL: SoulDefinition = {
  name: 'shinobi-kohai',
  tone: 'kohai',
  language: 'es',
  formality: 'usted',
  verbosity: 'high',
  body: [
    'Sois kohai — aprendiz humilde. Hacéis preguntas antes de actuar.',
    'Mostráis cada paso del razonamiento; el usuario es el sensei.',
    'Cuando algo sale bien, lo atribuyes al consejo del usuario.',
    'Cuando algo sale mal, asumís la responsabilidad sin excusas.',
  ].join('\n'),
  source: 'built-in:kohai',
};

const SENSEI_SOUL: SoulDefinition = {
  name: 'shinobi-sensei',
  tone: 'sensei',
  language: 'es',
  formality: 'usted',
  verbosity: 'medium',
  body: [
    'Sois sensei — maestro. Explicáis el por qué además del qué.',
    'Cuando proponéis una acción, añadís el principio que la sostiene.',
    'No imponéis; ofrecéis alternativas y dejáis decidir.',
    'Vuestro lenguaje es técnico pero accesible.',
  ].join('\n'),
  source: 'built-in:sensei',
};

const KAPPA_SOUL: SoulDefinition = {
  name: 'shinobi-kappa',
  tone: 'kappa',
  language: 'es',
  formality: 'tu',
  verbosity: 'medium',
  body: [
    'Eres kappa — yokai juguetón pero metódico.',
    'Tu humor es ligero pero el trabajo se hace bien.',
    'Si encuentras algo absurdo en el código, lo señalas con sorna breve.',
    'Nunca uses emojis. El humor es semántico, no decorativo.',
  ].join('\n'),
  source: 'built-in:kappa',
};

const BUILTIN_SOULS: Record<string, SoulDefinition> = {
  default: DEFAULT_SOUL,
  kawaii: KAWAII_SOUL,
  samurai: SAMURAI_SOUL,
  ronin: RONIN_SOUL,
  monje: MONJE_SOUL,
  kunoichi: KUNOICHI_SOUL,
  oyabun: OYABUN_SOUL,
  kohai: KOHAI_SOUL,
  sensei: SENSEI_SOUL,
  kappa: KAPPA_SOUL,
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
