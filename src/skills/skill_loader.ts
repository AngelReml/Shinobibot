import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { registerTool } from '../tools/tool_registry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APPROVED_DIR = path.join(process.env.APPDATA || os.homedir(), 'Shinobi', 'approved_skills');

function ensureDir(): void {
  if (!fs.existsSync(APPROVED_DIR)) fs.mkdirSync(APPROVED_DIR, { recursive: true });
}

export class SkillLoader {
  public static async approveAndLoad(skillId: string): Promise<{ success: boolean; message: string; skillName?: string }> {
    ensureDir();
    try {
      const baseUrl = process.env.OPENGRAVITY_URL || 'http://localhost:9900';
      const apiKey = process.env.SHINOBI_API_KEY || '';

      const detailRes = await axios.get(`${baseUrl}/v1/skills/${skillId}`, {
        headers: { 'X-Shinobi-Key': apiKey }, timeout: 10000
      });
      if (!detailRes.data.success) return { success: false, message: `skill not found: ${detailRes.data.error}` };
      const entry = JSON.parse(detailRes.data.output);

      if (entry.status !== 'verified' && entry.status !== 'promoted') {
        return { success: false, message: `Refusing to load skill with status '${entry.status}'. Only 'verified' or 'promoted' are loadable. Run validation first.` };
      }

      const codeRes = await axios.get(`${baseUrl}/v1/skills/${skillId}/code`, {
        headers: { 'X-Shinobi-Key': apiKey }, timeout: 10000
      });
      if (!codeRes.data.success) return { success: false, message: 'failed to fetch code' };

      const code = codeRes.data.output;
      const approvedFile = path.join(APPROVED_DIR, `${skillId}.mjs`);

      // Rewrite the import to the absolute path of Shinobi's tool registry (as file URL for ESM)
      const registryAbsPath = path.resolve(__dirname, '..', 'tools', 'tool_registry.js').replace(/\\/g, '/');
      const registryAbs = 'file:///' + registryAbsPath;
      let transformed = code
        .replace(/from ['"]\.\.\/\.\.\/tool_registry\.js['"]/g, `from '${registryAbs}'`)
        .replace(/from ['"]\.\.\/tool_registry\.js['"]/g, `from '${registryAbs}'`);

      // Strip TS type annotations so it can load as .mjs
      // (naive regex approach — acceptable as human-reviewed safety net)
      
      // Step 1: Replace the tool_registry import with one that only imports registerTool
      // This handles: import { type Tool, type ToolResult, registerTool } from '../../tool_registry.js';
      transformed = transformed.replace(
        /import\s+\{[^}]*\}\s+from\s+['"][^'"]*tool_registry[^'"]*['"];?/g,
        `import { registerTool } from '${registryAbs}';`
      );
      
      // Step 2: Strip remaining TS type annotations
      transformed = transformed
        .replace(/:\s*Tool\b/g, '')
        .replace(/:\s*ToolResult\b/g, '')
        .replace(/:\s*Promise<ToolResult>/g, '')
        .replace(/:\s*\{[^}]*string[^}]*\}\b/g, '')
        .replace(/as\s+\{[^}]+\}/g, '')
        .replace(/:\s*unknown\b/g, '');

      fs.writeFileSync(approvedFile, transformed, 'utf-8');

      const fileUrl = 'file:///' + approvedFile.replace(/\\/g, '/');
      try {
        await import(fileUrl);
      } catch (loadErr: any) {
        return { success: false, message: `dynamic import failed: ${loadErr.message?.substring(0, 300)}` };
      }

      return { success: true, message: `skill ${entry.name} loaded and registered`, skillName: entry.name };
    } catch (e: any) {
      return { success: false, message: `loader error: ${e.message}` };
    }
  }

  public static listApprovedFiles(): string[] {
    ensureDir();
    return fs.readdirSync(APPROVED_DIR).filter(f => f.endsWith('.mjs'));
  }

  public static async reloadAllApproved(): Promise<{ loaded: number; errors: string[] }> {
    ensureDir();
    const files = this.listApprovedFiles();
    let loaded = 0;
    const errors: string[] = [];
    for (const f of files) {
      try {
        const fileUrl = 'file:///' + path.join(APPROVED_DIR, f).replace(/\\/g, '/');
        await import(fileUrl);
        loaded++;
      } catch (e: any) {
        errors.push(`${f}: ${e.message?.substring(0, 200)}`);
      }
    }
    return { loaded, errors };
  }
}
