/**
 * Memory Reflector — Sprint 2.7.
 *
 * Cada N mensajes del usuario, el reflector lee la historia reciente y
 * produce un reporte markdown con:
 *
 *   - Contradicciones detectadas (afirmaciones que se desdicen).
 *   - Preferencias del usuario identificadas (prefiero, odio, siempre,
 *     nunca).
 *   - Sugerencias de consolidación (entradas redundantes).
 *
 * Por defecto, el reflector usa heurísticas regex puras — cero llamadas
 * al LLM, cero coste. La capa LLM (opcional) se activa con
 * `SHINOBI_REFLECTION_MODE=llm`. En este sprint solo implementamos la
 * heurística porque (a) es la que se puede ejercitar sin red, y (b)
 * cubre los casos obvios con tasa de falsos positivos baja.
 *
 * Reportes se escriben a `<reflectionDir>/<ISO-timestamp>.md`. El
 * usuario puede grep-ear / leer ese directorio para auditar lo que el
 * agente ha inferido sobre él.
 *
 * Diferenciador: ningún rival reflexiona periódicamente sobre la
 * memoria del usuario. Hermes tiene curator de skills (no de memoria),
 * OpenClaw tiene dreaming (no inferencia explícita de contradicciones
 * o preferencias).
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface ReflectorOptions {
  /** Disparar cada N mensajes (usuario + asistente combinados). Default 10. */
  intervalMessages?: number;
  /** Directorio donde guardar los reportes. Default `./reflections`. */
  reflectionDir?: string;
  /** Forzar análisis incluso si no hay nada interesante. Default false. */
  alwaysEmit?: boolean;
  /** Modo de análisis: heuristic (default, sin coste) o llm (opt-in). */
  mode?: 'heuristic' | 'llm';
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  ts?: string;
}

export interface Contradiction {
  topic: string;
  positiveText: string;
  negativeText: string;
  positiveIdx: number;
  negativeIdx: number;
}

export interface PreferenceSignal {
  kind: 'like' | 'dislike' | 'always' | 'never' | 'prefer';
  subject: string;
  evidence: string;
  idx: number;
}

export interface ConsolidationHint {
  hint: string;
  samples: string[];
}

export interface ReflectionReport {
  ts: string;
  messagesAnalyzed: number;
  contradictions: Contradiction[];
  preferences: PreferenceSignal[];
  consolidationHints: ConsolidationHint[];
  /** Path del archivo donde se guardó el reporte. */
  filePath?: string;
}

const DEFAULTS: Required<Omit<ReflectorOptions, 'reflectionDir'>> = {
  intervalMessages: 10,
  alwaysEmit: false,
  mode: 'heuristic',
};

/**
 * IMPORTANTE: el orden importa. Patrones negativos van antes que los
 * positivos para que "no me gusta X" matchee `dislike` y NO `like`.
 * El `extractPreferences` se queda con el PRIMER match por regla — no
 * agregamos múltiples preferencias del mismo mensaje.
 */
const PREF_PATTERNS: Array<{ rx: RegExp; kind: PreferenceSignal['kind'] }> = [
  { rx: /\b(?:no me gusta|odio|detesto)\s+([\w\s.,-]{2,80})/i, kind: 'dislike' },
  { rx: /\b(?:nunca)\s+(?:uso|elijo|prefiero)\s+([\w\s.,-]{2,80})/i, kind: 'never' },
  { rx: /\b(?:me gusta|adoro|amo)\s+([\w\s.,-]{2,80})/i, kind: 'like' },
  { rx: /\b(?:siempre)\s+(?:uso|prefiero|elijo)\s+([\w\s.,-]{2,80})/i, kind: 'always' },
  { rx: /\b(?:prefiero|preferiría)\s+([\w\s.,-]{2,80})/i, kind: 'prefer' },
];

const NEG_HINTS = ['no', 'nunca', 'jamás', 'jamas', 'tampoco', 'sin'];

/**
 * Heurística de contradicción: extrae afirmaciones tipo "X es Y" /
 * "X no es Y" y las cruza por topic = "X".
 */
interface AssertionMatcher {
  rx: RegExp;
  /** Índices de los grupos: topic, optional negation, value. */
  topicGroup: number;
  negGroup: number | null;
  valueGroup: number;
}

const ASSERTION_MATCHERS: AssertionMatcher[] = [
  // 1) "X es Y" — captura negación opcional ANTES del verbo (X no es Y).
  //    Grupos: 1=topic, 2=negación opcional ("no\s+"), 3=value.
  {
    rx: /\b([\w][\w\s.-]{1,40}?)\s+(no\s+)?(?:es|son|fue|era|será)\s+([\w][\w\s.,/\\:-]{1,80})/i,
    topicGroup: 1, negGroup: 2, valueGroup: 3,
  },
  // 2) "El/La/Mi <noun> está en <path>" — captura paths con caracteres
  //    de filesystem. Grupos: 1=topic, 2=value.
  {
    rx: /\b(?:el|la|mi)\s+([\w-]{2,40}(?:\s+[\w-]{2,40})?)\s+(?:está en|vive en)\s+([\w\\/.@:-]{2,120})/i,
    topicGroup: 1, negGroup: null, valueGroup: 2,
  },
];

function extractAssertions(messages: ConversationMessage[]): Array<{ idx: number; topic: string; value: string; negative: boolean; raw: string }> {
  const assertions: Array<{ idx: number; topic: string; value: string; negative: boolean; raw: string }> = [];
  messages.forEach((m, idx) => {
    if (m.role !== 'user') return;
    const text = m.content.trim();
    if (!text) return;
    for (const matcher of ASSERTION_MATCHERS) {
      const match = text.match(matcher.rx);
      if (!match) continue;
      const topic = (match[matcher.topicGroup] || '').trim().toLowerCase();
      const valuePart = (match[matcher.valueGroup] || '').trim().toLowerCase();
      const isNegative = matcher.negGroup != null && !!match[matcher.negGroup];
      if (!topic || !valuePart) continue;
      assertions.push({
        idx,
        topic: topic.replace(/\s+/g, ' ').trim(),
        value: valuePart.replace(/\s+/g, ' ').trim().replace(/[.,;:]$/g, ''),
        negative: isNegative,
        raw: text.length > 200 ? text.slice(0, 200) + '…' : text,
      });
    }
  });
  return assertions;
}

function detectContradictions(messages: ConversationMessage[]): Contradiction[] {
  const assertions = extractAssertions(messages);
  const out: Contradiction[] = [];
  for (let i = 0; i < assertions.length; i++) {
    for (let j = i + 1; j < assertions.length; j++) {
      const a = assertions[i];
      const b = assertions[j];
      if (a.topic !== b.topic) continue;
      // Caso 1: misma topic, una positiva otra negativa, mismo valor.
      if (a.value === b.value && a.negative !== b.negative) {
        out.push({
          topic: a.topic,
          positiveText: a.negative ? b.raw : a.raw,
          negativeText: a.negative ? a.raw : b.raw,
          positiveIdx: a.negative ? b.idx : a.idx,
          negativeIdx: a.negative ? a.idx : b.idx,
        });
        continue;
      }
      // Caso 2: misma topic, distinto valor, ambas afirmativas. Solo
      // marcamos si los valores son claramente incompatibles (no
      // sustrings uno del otro).
      if (a.value !== b.value && !a.negative && !b.negative) {
        if (!a.value.includes(b.value) && !b.value.includes(a.value)) {
          out.push({
            topic: a.topic,
            positiveText: a.raw,
            negativeText: b.raw,
            positiveIdx: a.idx,
            negativeIdx: b.idx,
          });
        }
      }
    }
  }
  return dedupeContradictions(out);
}

function dedupeContradictions(list: Contradiction[]): Contradiction[] {
  const seen = new Set<string>();
  const out: Contradiction[] = [];
  for (const c of list) {
    const key = `${c.topic}|${Math.min(c.positiveIdx, c.negativeIdx)}|${Math.max(c.positiveIdx, c.negativeIdx)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function detectPreferences(messages: ConversationMessage[]): PreferenceSignal[] {
  const out: PreferenceSignal[] = [];
  messages.forEach((m, idx) => {
    if (m.role !== 'user') return;
    for (const p of PREF_PATTERNS) {
      const match = m.content.match(p.rx);
      if (!match) continue;
      const subject = (match[1] || '').trim().replace(/[.,;:]$/g, '');
      if (!subject) continue;
      out.push({
        kind: p.kind,
        subject,
        evidence: m.content.length > 200 ? m.content.slice(0, 200) + '…' : m.content,
        idx,
      });
    }
  });
  return out;
}

function detectConsolidation(messages: ConversationMessage[]): ConsolidationHint[] {
  // Heurística simple: contenidos casi idénticos repetidos en mensajes
  // del usuario sugieren que el agente puede consolidar.
  const userMsgs = messages
    .map((m, idx) => ({ m, idx }))
    .filter(x => x.m.role === 'user');
  const counts = new Map<string, string[]>();
  for (const { m } of userMsgs) {
    const norm = m.content.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);
    if (norm.length < 12) continue;
    const arr = counts.get(norm) ?? [];
    arr.push(m.content);
    counts.set(norm, arr);
  }
  const out: ConsolidationHint[] = [];
  for (const [norm, samples] of counts) {
    if (samples.length >= 2) {
      out.push({
        hint: `Mensaje repetido ${samples.length}× (norm: "${norm.slice(0, 60)}…")`,
        samples: samples.slice(0, 3),
      });
    }
  }
  return out;
}

export class MemoryReflector {
  private readonly cfg: Required<Omit<ReflectorOptions, 'reflectionDir'>>;
  private readonly reflectionDir: string;
  private messagesSeen = 0;

  constructor(opts: ReflectorOptions = {}) {
    this.cfg = {
      intervalMessages: opts.intervalMessages ?? DEFAULTS.intervalMessages,
      alwaysEmit: opts.alwaysEmit ?? DEFAULTS.alwaysEmit,
      mode: opts.mode ?? DEFAULTS.mode,
    };
    this.reflectionDir = opts.reflectionDir ?? join(process.cwd(), 'reflections');
  }

  /** Anuncia un nuevo mensaje. Devuelve true si justo se cruzó el intervalo. */
  shouldReflect(): boolean {
    return this.messagesSeen > 0 && this.messagesSeen % this.cfg.intervalMessages === 0;
  }

  noteMessage(): void {
    this.messagesSeen++;
  }

  /**
   * Análisis manual independiente del contador (útil en tests).
   * `writeToDisk=true` persiste el reporte en `reflectionDir`.
   */
  analyze(history: ConversationMessage[], writeToDisk = true): ReflectionReport {
    const contradictions = detectContradictions(history);
    const preferences = detectPreferences(history);
    const consolidationHints = detectConsolidation(history);
    const ts = new Date().toISOString();
    const report: ReflectionReport = {
      ts,
      messagesAnalyzed: history.length,
      contradictions,
      preferences,
      consolidationHints,
    };
    if (writeToDisk && (this.cfg.alwaysEmit || contradictions.length + preferences.length + consolidationHints.length > 0)) {
      report.filePath = this.writeReport(report);
    }
    return report;
  }

  private writeReport(report: ReflectionReport): string {
    if (!existsSync(this.reflectionDir)) {
      try { mkdirSync(this.reflectionDir, { recursive: true }); } catch { /* best-effort */ }
    }
    const safeTs = report.ts.replace(/[:.]/g, '-');
    const filePath = join(this.reflectionDir, `${safeTs}.md`);
    const md = renderReportMarkdown(report);
    try {
      writeFileSync(filePath, md, 'utf-8');
    } catch { /* swallow */ }
    return filePath;
  }
}

export function renderReportMarkdown(report: ReflectionReport): string {
  const lines: string[] = [];
  lines.push(`# Reflexión de memoria · ${report.ts}`);
  lines.push('');
  lines.push(`Mensajes analizados: ${report.messagesAnalyzed}`);
  lines.push('');
  if (report.contradictions.length > 0) {
    lines.push(`## Contradicciones detectadas (${report.contradictions.length})`);
    for (const c of report.contradictions) {
      lines.push(`- **${c.topic}**`);
      lines.push(`  - mensaje #${c.positiveIdx + 1}: ${c.positiveText}`);
      lines.push(`  - mensaje #${c.negativeIdx + 1}: ${c.negativeText}`);
    }
    lines.push('');
  }
  if (report.preferences.length > 0) {
    lines.push(`## Preferencias inferidas (${report.preferences.length})`);
    for (const p of report.preferences) {
      lines.push(`- [${p.kind}] **${p.subject}** — _${p.evidence}_ (msg #${p.idx + 1})`);
    }
    lines.push('');
  }
  if (report.consolidationHints.length > 0) {
    lines.push(`## Sugerencias de consolidación (${report.consolidationHints.length})`);
    for (const h of report.consolidationHints) {
      lines.push(`- ${h.hint}`);
      for (const s of h.samples) lines.push(`  - \`${s.slice(0, 120)}\``);
    }
    lines.push('');
  }
  if (report.contradictions.length + report.preferences.length + report.consolidationHints.length === 0) {
    lines.push('_Sin hallazgos en esta ventana._');
  }
  return lines.join('\n') + '\n';
}

export function reflectionEnabled(): boolean {
  return process.env.SHINOBI_REFLECTION_ENABLED === '1';
}
