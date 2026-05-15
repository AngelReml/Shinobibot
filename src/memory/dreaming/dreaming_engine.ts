/**
 * DreamingEngine — corre cíclicamente (cada N horas o on-idle) y
 * produce un "dream" diario en formato markdown:
 *
 *   `<dreamsDir>/<YYYY-MM-DD>.md`
 *
 * Cada dream tiene:
 *   - sección "Entidades nuevas hoy"
 *   - sección "Entidades recurrentes"
 *   - sección "Preferencias detectadas"
 *   - sección "Decisiones del día"
 *   - sección "Tools más usadas"
 *
 * Diferencia con `memory_reflector.ts` (Sprint 2.7): el reflector
 * detecta contradicciones cada N msgs DURANTE la sesión; este corre
 * a posteriori sobre buckets de días completos para consolidación
 * de medio plazo (paridad OpenClaw Dreaming).
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { MemoryMessage } from '../providers/types.js';
import { bucketByDay } from './day_bucket.js';
import { extractEntities, diffEntities, type Entity } from './entity_resolver.js';

export interface DreamingOptions {
  /** Carpeta donde escribir los dream files. */
  dreamsDir: string;
  /** Función now() inyectable. */
  nowFn?: () => Date;
}

export interface DreamReport {
  date: string;
  filePath: string;
  novel: Entity[];
  recurring: Entity[];
  preferences: Entity[];
  decisions: Entity[];
  tools: Entity[];
  totalMessages: number;
}

export class DreamingEngine {
  constructor(public readonly opts: DreamingOptions) {
    if (!existsSync(opts.dreamsDir)) {
      mkdirSync(opts.dreamsDir, { recursive: true });
    }
  }

  /**
   * Procesa los mensajes y genera dream files para todos los días que
   * tengan mensajes. Devuelve la lista de reports generados.
   */
  async dream(messages: MemoryMessage[]): Promise<DreamReport[]> {
    const buckets = bucketByDay(messages);
    const reports: DreamReport[] = [];

    let prevEntities: Entity[] = [];
    for (const [date, dayMsgs] of buckets) {
      if (date === 'unknown') continue;
      const entities = extractEntities(dayMsgs);
      const { novel, recurring } = diffEntities(entities, prevEntities);

      const preferences = entities.filter(e => e.kind === 'preference');
      const decisions = entities.filter(e => e.kind === 'decision');
      const tools = entities.filter(e => e.kind === 'tool');

      const filePath = join(this.opts.dreamsDir, `${date}.md`);
      const md = this.renderDream(date, dayMsgs.length, { novel, recurring, preferences, decisions, tools });
      writeFileSync(filePath, md, 'utf-8');

      reports.push({
        date, filePath,
        novel, recurring, preferences, decisions, tools,
        totalMessages: dayMsgs.length,
      });
      prevEntities = entities;
    }
    return reports;
  }

  private renderDream(date: string, msgCount: number, data: {
    novel: Entity[]; recurring: Entity[];
    preferences: Entity[]; decisions: Entity[]; tools: Entity[];
  }): string {
    const lines: string[] = [];
    lines.push(`# Dream · ${date}`);
    lines.push('');
    lines.push(`_Procesado: ${this.now().toISOString()}_`);
    lines.push(`_Mensajes del día: ${msgCount}_`);
    lines.push('');

    lines.push('## Entidades nuevas hoy');
    if (data.novel.length === 0) lines.push('_(ninguna)_');
    else for (const e of data.novel.slice(0, 20)) {
      lines.push(`- **${e.text}** (${e.kind}, ${e.count}×)`);
    }
    lines.push('');

    lines.push('## Entidades recurrentes (del día previo)');
    if (data.recurring.length === 0) lines.push('_(ninguna — primer día con datos)_');
    else for (const e of data.recurring.slice(0, 10)) {
      lines.push(`- ${e.text} (${e.kind}, ${e.count}×)`);
    }
    lines.push('');

    if (data.preferences.length > 0) {
      lines.push('## Preferencias detectadas');
      for (const p of data.preferences.slice(0, 10)) {
        lines.push(`- ${p.text} (${p.count}×)`);
      }
      lines.push('');
    }

    if (data.decisions.length > 0) {
      lines.push('## Decisiones del día');
      for (const d of data.decisions.slice(0, 10)) {
        lines.push(`- ${d.text}`);
      }
      lines.push('');
    }

    if (data.tools.length > 0) {
      lines.push('## Tools más usadas');
      for (const t of data.tools.slice(0, 10)) {
        lines.push(`- \`${t.text}\` (${t.count}×)`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('_Generado por DreamingEngine — paridad arquitectónica OpenClaw Dreaming._');
    return lines.join('\n');
  }

  private now(): Date {
    return this.opts.nowFn ? this.opts.nowFn() : new Date();
  }

  /** Lista dream files disponibles. */
  listDreams(): string[] {
    if (!existsSync(this.opts.dreamsDir)) return [];
    return readdirSync(this.opts.dreamsDir)
      .filter(f => f.endsWith('.md'))
      .sort();
  }
}
