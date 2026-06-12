// skill_loader.ts — carga de skills locales (Fase 2, extirpación OG 2026-06-12)
// approveAndLoad remoto eliminado: solo carga desde APPROVED_DIR local.
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APPROVED_DIR = path.join(process.env.APPDATA || os.homedir(), 'Shinobi', 'approved_skills');

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
