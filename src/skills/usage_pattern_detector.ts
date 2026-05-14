/**
 * Usage Pattern Detector — observa secuencias de tool_calls por sesión y
 * detecta cuando el usuario está repitiendo el MISMO patrón 3+ veces
 * (Sprint 2.6).
 *
 * Diferencia clave vs `src/skills/skill_manager.ts`:
 *   - skill_manager actual: dispara solo cuando hay FALLOS consecutivos
 *     (recovery skills) o cuando una tool se ejecuta exitosamente N
 *     veces aisladas (shortcut).
 *   - Este detector: busca SECUENCIAS reproducibles. P.ej. el usuario
 *     siempre hace `read_file → search_files → edit_file` para
 *     refactorizar; tras 3 corridas idénticas, propone una skill
 *     "refactor-search-and-edit".
 *
 * Diseño:
 *   - `recordSequence(seq)` añade una secuencia de tool names al log.
 *   - Internamente normalizamos cada sequence (string join '→') y
 *     contamos ocurrencias.
 *   - Cuando una sequence alcanza `threshold` (default 3) ocurrencias y
 *     NO se ha propuesto antes en esta sesión, devuelve una propuesta
 *     `{ proposed: true, draft: ParsedSkill }`.
 *   - El draft tiene `status: pending_confirmation` en el frontmatter
 *     para que el operador acepte explícito antes de firmar.
 *
 * Persistencia: opcional, vía `loadFromDisk` / `saveToDisk` JSON.
 *
 * Diferenciador competitivo: ningún rival propone skills a partir de
 * patrones reales del usuario; Hermes crea skills tras tareas
 * completadas (auto-curator), OpenClaw no.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { createHash } from 'crypto';
import type { ParsedSkill } from './skill_md_parser.js';

export interface PatternDetectorOptions {
  /** Mínimo de pasos en la secuencia para considerarla candidata (default 2). */
  minLength?: number;
  /** Máximo de pasos para no proponer skills monstruo (default 8). */
  maxLength?: number;
  /** Cuántas ocurrencias disparan la propuesta (default 3). */
  threshold?: number;
  /** Path opcional de persistencia. */
  persistPath?: string;
}

export interface PatternRecord {
  /** Sequence canónica: "tool_a→tool_b→tool_c". */
  signature: string;
  /** Tools en orden. */
  tools: string[];
  /** Cuántas veces vista. */
  count: number;
  /** Si ya se propuso skill (no volver a proponer). */
  proposed: boolean;
  /** Timestamp de la 1ª vez (ISO). */
  firstSeenAt: string;
  /** Timestamp de la última (ISO). */
  lastSeenAt: string;
}

export interface ProposalResult {
  proposed: boolean;
  record?: PatternRecord;
  draft?: ParsedSkill;
}

const DEFAULTS = {
  minLength: 2,
  maxLength: 8,
  threshold: 3,
};

export class UsagePatternDetector {
  private readonly cfg: Required<Omit<PatternDetectorOptions, 'persistPath'>>;
  private readonly persistPath?: string;
  private readonly records = new Map<string, PatternRecord>();

  constructor(opts: PatternDetectorOptions = {}) {
    this.cfg = {
      minLength: opts.minLength ?? DEFAULTS.minLength,
      maxLength: opts.maxLength ?? DEFAULTS.maxLength,
      threshold: opts.threshold ?? DEFAULTS.threshold,
    };
    this.persistPath = opts.persistPath;
    if (this.persistPath) this.loadFromDisk();
  }

  /**
   * Registra una secuencia de tools observada. Devuelve propuesta si
   * justo se cruzó el threshold.
   */
  recordSequence(tools: string[]): ProposalResult {
    if (!Array.isArray(tools) || tools.length < this.cfg.minLength) {
      return { proposed: false };
    }
    if (tools.length > this.cfg.maxLength) {
      // No proponemos skills demasiado largas para no atrapar
      // conversaciones enteras.
      return { proposed: false };
    }
    const sig = tools.join('→');
    const now = new Date().toISOString();
    let rec = this.records.get(sig);
    if (!rec) {
      rec = { signature: sig, tools: [...tools], count: 0, proposed: false, firstSeenAt: now, lastSeenAt: now };
      this.records.set(sig, rec);
    }
    rec.count += 1;
    rec.lastSeenAt = now;
    this.saveToDisk();

    if (rec.count >= this.cfg.threshold && !rec.proposed) {
      rec.proposed = true;
      this.saveToDisk();
      return { proposed: true, record: rec, draft: this.buildDraft(rec) };
    }
    return { proposed: false, record: rec };
  }

  /** Genera un borrador heurístico de SKILL.md para confirmación humana. */
  buildDraft(rec: PatternRecord): ParsedSkill {
    const hash = createHash('sha256').update(rec.signature).digest('hex').slice(0, 8);
    const name = `auto-pattern-${hash}`;
    const description = `Patrón observado ${rec.count}× durante la sesión: ${rec.tools.join(' → ')}. Auto-propuesto por el usage pattern detector — requiere confirmación humana antes de aprobar.`;
    const body = [
      `# Patrón detectado: ${rec.tools.join(' → ')}`,
      '',
      `Esta skill se generó automáticamente al detectar que la secuencia`,
      `\`${rec.signature}\` se repitió ${rec.count} veces.`,
      '',
      `Primera vez observada: ${rec.firstSeenAt}`,
      `Última vez observada: ${rec.lastSeenAt}`,
      '',
      '## Pasos sugeridos (revisar y editar)',
      '',
      ...rec.tools.map((t, i) => `${i + 1}. Llamar a la tool \`${t}\` con los args apropiados al contexto.`),
      '',
      '## Para activar',
      '',
      '1. Revisa los pasos y añade prompts/contexto específico de tu workflow.',
      '2. Define `trigger_keywords` en el frontmatter para que el agente la active.',
      '3. Mueve este archivo de `skills/pending/` a `skills/approved/` para firmarlo.',
    ].join('\n');
    return {
      frontmatter: {
        name,
        description,
        status: 'pending_confirmation',
        source: 'auto',
        source_kind: 'usage_pattern',
        source_pattern_hash: hash,
        trigger_keywords: [],
      },
      body,
    };
  }

  snapshot(): PatternRecord[] {
    return [...this.records.values()].sort((a, b) => b.count - a.count);
  }

  reset(): void {
    this.records.clear();
    if (this.persistPath && existsSync(this.persistPath)) {
      try { writeFileSync(this.persistPath, JSON.stringify({ records: [] }, null, 2), 'utf-8'); } catch { /* swallow */ }
    }
  }

  private loadFromDisk(): void {
    if (!this.persistPath || !existsSync(this.persistPath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.persistPath, 'utf-8'));
      if (Array.isArray(raw?.records)) {
        for (const r of raw.records) {
          if (r && typeof r === 'object' && r.signature) {
            this.records.set(r.signature, r as PatternRecord);
          }
        }
      }
    } catch { /* swallow */ }
  }

  private saveToDisk(): void {
    if (!this.persistPath) return;
    try {
      const dir = dirname(this.persistPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(
        this.persistPath,
        JSON.stringify({ records: [...this.records.values()] }, null, 2),
        'utf-8',
      );
    } catch { /* swallow */ }
  }
}
