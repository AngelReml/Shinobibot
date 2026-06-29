/**
 * TEST DE INVARIANTE DE EGRESS — E3 (Soberano)
 *
 * Recorre TODOS los archivos TypeScript de src/ y verifica que ningún módulo
 * fuera de EGRESS_ALLOWLIST importa directamente axios/fetch/node-fetch/got.
 *
 * Si un futuro contribuidor añade una llamada de red directa fuera de los
 * módulos autorizados, este test lo captura en CI.
 *
 * Es el equivalente de seguridad de red al test de invariante de security (E1).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { EGRESS_ALLOWLIST, NETWORK_IMPORT_PATTERNS } from '../egress_policy.js';

const SRC_ROOT = path.resolve(process.cwd(), 'src');

/** Lee todos los .ts de src/ recursivamente, excluyendo __tests__ y .d.ts */
function collectSourceFiles(dir: string, files: string[] = []): string[] {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (entry !== 'node_modules' && entry !== '__tests__') {
        collectSourceFiles(full, files);
      }
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

/** Normaliza un path absoluto a relativo desde SRC_ROOT para comparación con allowlist. */
function relFromSrcRoot(absPath: string): string {
  return 'src/' + path.relative(SRC_ROOT, absPath).replace(/\\/g, '/');
}

describe('INVARIANTE DE EGRESS (E3 — Soberano)', () => {
  const sourceFiles = collectSourceFiles(SRC_ROOT);

  it('todos los archivos de src/ fueron encontrados (sanity check)', () => {
    // Al menos 100 ficheros .ts (el repo tiene >500)
    expect(sourceFiles.length).toBeGreaterThan(100);
  });

  it('ningún módulo fuera de la allowlist importa axios/fetch/node-fetch/got directamente', () => {
    const violations: string[] = [];

    for (const file of sourceFiles) {
      const rel = relFromSrcRoot(file);
      // Excluir el propio fichero de política: sus arrays contienen los patrones
      // como cadenas de datos, no como imports reales.
      if (rel === 'src/egress/egress_policy.ts') continue;
      const isAllowlisted = EGRESS_ALLOWLIST.some(prefix => rel.startsWith(prefix) || rel.includes(prefix));
      if (isAllowlisted) continue;

      const content = fs.readFileSync(file, 'utf-8');
      for (const pattern of NETWORK_IMPORT_PATTERNS) {
        if (content.includes(pattern)) {
          violations.push(`${rel}: contiene "${pattern}" fuera de EGRESS_ALLOWLIST`);
          break; // un violation por archivo es suficiente
        }
      }
    }

    if (violations.length > 0) {
      const msg = [
        `\n[EGRESS VIOLATION] Los siguientes módulos hacen llamadas de red directas`,
        `sin estar en EGRESS_ALLOWLIST (src/egress/egress_policy.ts):`,
        ...violations.map(v => `  • ${v}`),
        ``,
        `Solución: añadir el módulo a EGRESS_ALLOWLIST (requiere justificación)`,
        `o enrutar la llamada a través de un módulo ya autorizado.`,
      ].join('\n');
      expect.fail(msg);
    }
  });

  it('los módulos de la allowlist existen en el repo', () => {
    const missing: string[] = [];
    for (const prefix of EGRESS_ALLOWLIST) {
      const absPrefix = path.join(process.cwd(), prefix);
      // Puede ser dir o file prefix
      const exists = fs.existsSync(absPrefix) ||
        fs.existsSync(absPrefix + '.ts') ||
        // Check if any file matches the prefix
        sourceFiles.some(f => f.startsWith(absPrefix) || relFromSrcRoot(f).startsWith(prefix));
      if (!exists) missing.push(prefix);
    }
    if (missing.length > 0) {
      expect.fail(`Prefijos en EGRESS_ALLOWLIST que no existen en el repo: ${missing.join(', ')}`);
    }
  });

  it('el egressGate permite llamadas desde módulos autorizados', async () => {
    const { egressGate } = await import('../egress_policy.js');
    const result = egressGate({
      destination: 'api.anthropic.com',
      source: 'src/providers/anthropic_client.ts',
      reason: 'LLM call',
    });
    expect(result.allowed).toBe(true);
  });

  it('el egressGate bloquea llamadas desde módulos no autorizados', async () => {
    const { egressGate } = await import('../egress_policy.js');
    const result = egressGate({
      destination: 'example.com',
      source: 'src/memory/contradiction_filter.ts',
      reason: 'test call',
    });
    expect(result.allowed).toBe(false);
  });

  it('datos sensibles marcan useLocalModel=true aunque vengan de módulo autorizado', async () => {
    const { egressGate } = await import('../egress_policy.js');
    const result = egressGate({
      destination: 'api.anthropic.com',
      source: 'src/providers/anthropic_client.ts',
      reason: 'LLM call con datos fiscales',
      sensitivity: 'sensitive',
    });
    expect(result.allowed).toBe(true);
    expect(result.useLocalModel).toBe(true);
  });
});
