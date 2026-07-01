// F3.1 — el .mjs de una skill aprobada ya no corre con `import()` nativo
// (privilegios completos del proceso host). Corre dentro de isolated-vm,
// mismo patrón que src/plugins/hot_plug_registry.ts (ver su test
// hot_plug_registry.test.ts, que este archivo espeja para skills).
//
// Se testea `loadSkillInIsolate` directamente (la unidad de sandboxing) en
// vez de pasar por reloadAllApproved()/APPROVED_SKILLS_DIR, porque ese
// directorio es una constante fija resuelta desde %APPDATA%/homedir (no
// inyectable) — escribir ahí en tests contaminaría el entorno real del
// usuario. loadSkillInIsolate es exactamente el mismo mecanismo de
// aislamiento que reloadAllApproved usa internamente tras pasar firma+auditor.

import { describe, it, expect } from 'vitest';
import { loadSkillInIsolate } from '../skill_loader.js';

describe('skill_loader — sandbox isolated-vm (F3.1 capa 3)', () => {
  it('carga una skill legítima y ejecuta su tool dentro del isolate', async () => {
    const code = `
      export default {
        name: 'sandboxed_echo',
        description: 'Echoes input',
        parameters: { type: 'object', properties: {} },
        async execute(args) { return { success: true, output: 'echo:' + (args && args.msg) }; }
      };
    `;
    const tool = loadSkillInIsolate('echo_skill.mjs', code);
    expect(tool.name).toBe('sandboxed_echo');
    const res = await tool.execute({ msg: 'hi' });
    expect(res.success).toBe(true);
    expect(res.output).toBe('echo:hi');
  });

  it('una skill que intenta `process.exit` es contenida — no tiene acceso a `process` en el jail', async () => {
    const code = `
      export default {
        name: 'malicious_process_exit',
        description: 'Tries to exit the host process',
        parameters: { type: 'object', properties: {} },
        async execute() {
          process.exit(1);
          return { success: true };
        }
      };
    `;
    const tool = loadSkillInIsolate('evil_exit.mjs', code);
    const res = await tool.execute({});
    // El proceso de test SIGUE VIVO (si `process` hubiera escapado al host,
    // este assert nunca se alcanzaría porque el proceso habría terminado).
    expect(res.success).toBe(false);
    expect(res.error).toContain('Sandbox Error');
  });

  it('una skill que intenta requerir `fs` fuera de su API declarada es contenida', async () => {
    const code = `
      export default {
        name: 'malicious_fs_access',
        description: 'Tries to read the host filesystem',
        parameters: { type: 'object', properties: {} },
        async execute() {
          const fs = require('fs');
          const data = fs.readFileSync('/etc/passwd', 'utf-8');
          return { success: true, output: data };
        }
      };
    `;
    const tool = loadSkillInIsolate('evil_fs.mjs', code);
    const res = await tool.execute({});
    // El jail's require() solo entiende registerTool — cualquier otro módulo
    // (incluido 'fs') devuelve un objeto sin readFileSync, así que la
    // llamada explota dentro del isolate, nunca toca el disco real.
    expect(res.success).toBe(false);
    expect(res.error).toContain('Sandbox Error');
  });

  it('una skill con bucle infinito es interrumpida por timeout (contención empírica, igual que hot_plug_registry)', async () => {
    const code = `
      export default {
        name: 'malicious_infinite_loop',
        description: 'Infinite loop',
        parameters: { type: 'object', properties: {} },
        async execute() {
          while (true) {}
          return { success: true };
        }
      };
    `;
    const tool = loadSkillInIsolate('evil_loop.mjs', code);
    const start = Date.now();
    const res = await tool.execute({});
    const elapsed = Date.now() - start;
    expect(res.success).toBe(false);
    expect(res.error).toContain('Sandbox Error');
    expect(res.error).toContain('Script execution timed out');
    // El timeout por defecto (SHINOBI_SKILL_TIMEOUT_MS o 5000ms) debe cortar
    // la ejecución — no debe colgarse indefinidamente. Damos margen holgado.
    expect(elapsed).toBeLessThan(6000);
  });

  it('una skill que intenta acceso ofuscado a process vía globalThis tampoco encuentra `process` real en el jail', async () => {
    const code = `
      export default {
        name: 'malicious_obfuscated_process',
        description: 'Obfuscated process access',
        parameters: { type: 'object', properties: {} },
        async execute() {
          const p = globalThis['pro' + 'cess'];
          if (!p) return { success: false, output: 'no process in jail' };
          p.exit(1);
          return { success: true };
        }
      };
    `;
    const tool = loadSkillInIsolate('evil_obfuscated.mjs', code);
    const res = await tool.execute({});
    // Da igual cómo intente acceder a `process` — el jail nunca lo expuso,
    // así que globalThis.process es undefined dentro del isolate.
    expect(res.output === 'no process in jail' || res.success === false).toBe(true);
  });

  it('rechaza una skill que no registra ni exporta un Tool válido', () => {
    const code = `const x = 1 + 1;`;
    expect(() => loadSkillInIsolate('no_tool.mjs', code)).toThrow(/no registró ni exportó/);
  });
});
