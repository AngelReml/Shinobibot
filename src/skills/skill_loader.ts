// skill_loader.ts — carga de skills locales (Fase 2, extirpación OG 2026-06-12).
// F3.1 (auditoría de remediación 2026-07): antes este módulo hacía
// `await import(fileUrl)` sobre el .mjs de la skill con privilegios completos
// del proceso host, protegido solo por la capa regex del auditor (~90
// patrones, evadible con ofuscación mínima). Ahora la defensa es en capas:
//
//   1. Firma/checksum (skill_signing.ts) + companion .md — capa de
//      integridad/provenance, sin PKI real (ver banner de skill_signing.ts).
//   2. Auditor AST + regex (skill_auditor.ts / auditor/ast_auditor.ts) —
//      rechaza cualquier finding 'critical', incluida ofuscación estructural.
//   3. SANDBOX DE EJECUCIÓN — el .mjs NUNCA se importa con `import()` nativo.
//      Se ejecuta dentro de un isolate v8 aislado (isolated-vm), mismo
//      patrón ya probado empíricamente en src/plugins/hot_plug_registry.ts
//      (64MB de memoria, timeout, contención de bucles infinitos). La skill
//      solo ve la superficie que se le expone explícitamente (console mudo,
//      require() que únicamente sirve registerTool) — sin acceso a
//      `process`, `fs`, `child_process` ni al resto del proceso host.
//
// approveAndLoad remoto eliminado: solo carga desde APPROVED_DIR local.
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import ivm from 'isolated-vm';
import { parseSkillMd } from './skill_md_parser.js';
import { verifySkill } from './skill_signing.js';
import { APPROVED_SKILLS_DIR } from './paths.js';
import { transformEsmToV8Script } from '../plugins/hot_plug_registry.js';
import { registerTool, unregisterTool, type Tool } from '../tools/tool_registry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APPROVED_DIR = APPROVED_SKILLS_DIR;

/** Memoria del isolate por skill (MB). Igual al límite ya probado en hot_plug_registry.ts. */
const SKILL_ISOLATE_MEMORY_MB = 64;
/** Timeout de carga del módulo (extracción de metadata + registro). CPU-only, síncrono. */
const SKILL_LOAD_TIMEOUT_MS = 500;
/** Timeout por invocación de la skill en ejecución. Configurable, igual patrón que plugins. */
function skillExecTimeoutMs(): number {
  return Number(process.env.SHINOBI_SKILL_TIMEOUT_MS) || 5000;
}

function ensureDir(): void {
  if (!fs.existsSync(APPROVED_DIR)) fs.mkdirSync(APPROVED_DIR, { recursive: true });
}

/** Nombres de tools cargados desde un .mjs, para poder desregistrar en reload. */
const loadedSkillTools = new Map<string, string>(); // filePath → toolName

/**
 * Construye el jail mínimo que el .mjs de la skill ve: console mudo (no hay
 * canal de I/O hacia el host salvo el valor de retorno) y un `require()`
 * que solo entiende `registerTool` — ni módulos de Node ni nada más. Igual
 * de restrictivo que hot_plug_registry.ts.
 */
const JAIL_BOOTSTRAP = `
  globalThis.console = { log: () => {}, warn: () => {}, error: () => {} };
  globalThis.require = function(mod) {
    return { registerTool: function(t) { globalThis.__registeredTool = t; } };
  };
  globalThis.module = { exports: {} };
`;

/**
 * Carga UNA skill .mjs dentro de un isolate aislado: extrae su Tool
 * (name/description/parameters) sin privilegios del proceso host, y
 * construye un Tool "blindado" cuyo execute() vuelve a correr dentro de un
 * isolate fresco en cada invocación (mismo patrón que HotPlugRegistry).
 * Lanza si el script no registra/exporta un Tool válido.
 */
export function loadSkillInIsolate(filePath: string, rawCode: string): Tool {
  const transformed = transformEsmToV8Script(rawCode);

  // 1. Extraer metadata de forma segura (isolate efímero, descartado tras esto).
  const extractIsolate = new ivm.Isolate({ memoryLimit: SKILL_ISOLATE_MEMORY_MB });
  const extractContext = extractIsolate.createContextSync();
  extractContext.evalSync(JAIL_BOOTSTRAP);

  try {
    extractIsolate.compileScriptSync(transformed).runSync(extractContext, { timeout: SKILL_LOAD_TIMEOUT_MS });
  } catch (e: any) {
    extractIsolate.dispose();
    throw new Error(`No se pudo extraer metadata de la skill ${filePath} dentro del sandbox: ${e.message}`);
  }

  const metadataStr = extractContext.evalSync(`
    let t = globalThis.__registeredTool || module.exports.default || module.exports;
    t ? JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters }) : null;
  `);
  extractIsolate.dispose();

  if (!metadataStr) {
    throw new Error(`La skill ${filePath} no registró ni exportó un Tool válido.`);
  }
  const metadata = JSON.parse(metadataStr);
  if (!metadata.name) {
    throw new Error(`La skill ${filePath} no registró ni exportó un Tool válido (falta name).`);
  }

  // 2. Tool envolvente: cada ejecución corre en un isolate NUEVO, contenida.
  const tool: Tool = {
    name: metadata.name,
    description: metadata.description,
    parameters: metadata.parameters,
    execute: async (args: any) => {
      const isolate = new ivm.Isolate({ memoryLimit: SKILL_ISOLATE_MEMORY_MB });
      const context = await isolate.createContext();
      try {
        const jail = context.global;
        await jail.set('global', jail.derefInto());
        await jail.set('args', new ivm.ExternalCopy(args).copyInto());
        await context.eval(JAIL_BOOTSTRAP);

        const script = await isolate.compileScript(transformed, { filename: filePath });
        await script.run(context, { timeout: SKILL_LOAD_TIMEOUT_MS });

        const runner = await isolate.compileScript(`
          (async () => {
            let t = globalThis.__registeredTool || module.exports.default || module.exports;
            if (!t || typeof t.execute !== 'function') throw new Error("skill.execute no es una función");
            const res = await t.execute(globalThis.args);
            return JSON.stringify(res);
          })()
        `);
        const resultStr = await runner.run(context, { timeout: skillExecTimeoutMs(), promise: true });
        return JSON.parse(resultStr);
      } catch (e: any) {
        return { success: false, output: '', error: `Sandbox Error: ${e.message}` };
      } finally {
        context.release();
        isolate.dispose();
      }
    },
  };

  return tool;
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
        // Capa 1 — verificar checksum de integridad antes de cargar el .mjs.
        // Cada .mjs debe tener un .md de acompañamiento con checksum válido.
        // (NO es autenticación de autor — ver banner de skill_signing.ts.)
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
          console.warn(`[skill_loader] ${f}: rechazada — verificación de checksum de integridad falló (${verdict.reason})`);
          errors.push(`${f}: rechazada — checksum de integridad inválido (${verdict.reason})`);
          continue;
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        // Capa 2 — auditor AST + regex. Cualquier finding crítico rechaza.
        const critical = scanText(content, f).filter((x: any) => x.level === 'critical');
        if (critical.length > 0) {
          errors.push(`${f}: rechazada — auditoría crítica (${critical.map((c: any) => c.rule).join(', ')})`);
          continue;
        }

        // Capa 3 — ejecución dentro de isolated-vm. Nunca `import()` nativo.
        const oldToolName = loadedSkillTools.get(filePath);
        if (oldToolName) unregisterTool(oldToolName);

        const tool = loadSkillInIsolate(filePath, content);
        registerTool(tool);
        loadedSkillTools.set(filePath, tool.name);
        loaded++;
      } catch (e: any) {
        errors.push(`${f}: ${e.message?.substring(0, 200)}`);
      }
    }
    return { loaded, errors };
  }
}
