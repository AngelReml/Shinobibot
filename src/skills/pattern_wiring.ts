/**
 * Cableado del usage_pattern_detector (P2).
 *
 * El orchestrator llama `recordToolPattern(toolSequence)` al cerrar cada
 * misión exitosa. El detector lleva la cuenta de secuencias de tools; cuando
 * una se repite 3× (entre misiones, persistido a disco), escribe un draft de
 * SKILL.md en `skills/pending/` para revisión humana.
 */

import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { UsagePatternDetector } from './usage_pattern_detector.js';
import { serializeSkillMd } from './skill_md_parser.js';

let _detector: UsagePatternDetector | null = null;

/** Singleton del detector — persiste entre misiones (ese es el punto: 3 corridas). */
export function patternDetector(): UsagePatternDetector {
  if (!_detector) {
    _detector = new UsagePatternDetector({
      persistPath: join(process.cwd(), 'skills', 'usage_patterns.json'),
    });
  }
  return _detector;
}

/**
 * Registra la secuencia de tools de una misión. Si un patrón cruza el
 * umbral (3×), escribe un draft de SKILL.md en `skills/pending/`. Devuelve
 * el path del draft propuesto, o null si no se propuso nada.
 */
export function recordToolPattern(tools: string[]): string | null {
  const prop = patternDetector().recordSequence(tools);
  if (!prop.proposed || !prop.draft) return null;
  const name = String(prop.draft.frontmatter.name ?? 'auto-pattern');
  const pendingDir = join(process.cwd(), 'skills', 'pending');
  if (!existsSync(pendingDir)) mkdirSync(pendingDir, { recursive: true });
  const file = join(pendingDir, `${name}.skill.md`);
  writeFileSync(file, serializeSkillMd(prop.draft), 'utf-8');
  console.log(`[Shinobi] usage_pattern_detector: patrón repetido ${prop.record?.count ?? 3}× → skill propuesta en ${file}`);
  return file;
}

/** Test helper: reinicia el singleton. */
export function _resetPatternWiring(): void { _detector = null; }
