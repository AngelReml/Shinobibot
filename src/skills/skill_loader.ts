// skill_loader.ts — carga de skills locales (Fase 2, extirpación OG 2026-06-12)
// approveAndLoad remoto eliminado: solo carga desde APPROVED_DIR local.
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { parseSkillMd } from './skill_md_parser.js';
import { verifySkill } from './skill_signing.js';
import { APPROVED_SKILLS_DIR } from './paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APPROVED_DIR = APPROVED_SKILLS_DIR;

function ensureDir(): void {
  if (!fs.existsSync(APPROVED_DIR)) fs.mkdirSync(APPROVED_DIR, { recursive: true });
}

export class SkillLoader {
  /** approveAndLoad from remote marketplace removed (OG extirpated).
   *  Skills are now loaded locally only via reloadAllApproved(). */
  public static async approveAndLoad(_skillId: string): Promise<{ success: boolean; message: string; skillName?: string }> {
    return { success: false, message: 'Remote marketplace removed. Place .mjs files in the approved_skills folder manually.' };
  }

  public static listApprovedFiles(): string[] {
    ensureDir();
    return fs.readdirSync(APPROVED_DIR).filter(f => f.endsWith('.mjs'));
  }

  public static async reloadAllApproved(): Promise<{ loaded: number; errors: string[] }> {
    ensureDir();
    const { scanText } = await import('./skill_auditor.js');
    const files = this.listApprovedFiles();
    let loaded = 0;
    const errors: string[] = [];
    for (const f of files) {
      try {
        const filePath = path.join(APPROVED_DIR, f);
        // FIX 0.4 — verificar firma antes de cargar el .mjs.
        // Cada .mjs debe tener un .md de acompañamiento con firma válida.
        const mdPath = path.join(APPROVED_DIR, f.replace(/\.mjs$/, '.md'));
        if (!fs.existsSync(mdPath)) {
          console.warn(`[skill_loader] ${f}: rechazada — falta companion .md (${f.replace(/\.mjs$/, '.md')})`);
          errors.push(`${f}: rechazada — falta .md de acompañamiento`);
          continue;
        }
        const mdContent = fs.readFileSync(mdPath, 'utf-8');
        const parsedMd = parseSkillMd(mdContent);
        const verdict = verifySkill(parsedMd);
        if (!verdict.valid) {
          console.warn(`[skill_loader] ${f}: rechazada — verificación de firma falló (${verdict.reason})`);
          errors.push(`${f}: rechazada — firma inválida (${verdict.reason})`);
          continue;
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        const critical = scanText(content, f).filter((x: any) => x.level === 'critical');
        if (critical.length > 0) {
          errors.push(`${f}: rechazada — auditoría crítica (${critical.map((c: any) => c.rule).join(', ')})`);
          continue;
        }
        const fileUrl = 'file:///' + filePath.replace(/\\\\/g, '/');
        await import(fileUrl);
        loaded++;
      } catch (e: any) {
        errors.push(`${f}: ${e.message?.substring(0, 200)}`);
      }
    }
    return { loaded, errors };
  }
}
