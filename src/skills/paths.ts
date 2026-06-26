/**
 * Canonical path constants for the skills subsystem.
 *
 * Two distinct directory strategies coexist in this codebase:
 *
 *   A) APPROVED_SKILLS_DIR — user-data directory for .mjs executable skills
 *      managed by SkillLoader. Lives under APPDATA/Shinobi/ (Windows-first,
 *      but falls back to homedir on macOS/Linux).
 *
 *   B) <cwd>/skills/approved/ — project-local directory for .md prompt skills
 *      managed by SkillManager, AnthropicSkillInstaller and registry/installer.
 *      These compute their path from process.cwd() or a passed-in base, so no
 *      shared constant is needed there — they are already consistent.
 *
 * Exporting APPROVED_SKILLS_DIR from this module makes A) a single source of
 * truth: if the location ever needs to change, it changes here, not in each
 * consumer.
 */
import * as os from 'os';
import * as path from 'path';

/**
 * Base directory for SkillLoader's approved .mjs executable skills.
 * Resolved once at module load (same as the previous inline constant).
 */
export const APPROVED_SKILLS_DIR: string = path.join(
  process.env.APPDATA || os.homedir(),
  'Shinobi',
  'approved_skills',
);
