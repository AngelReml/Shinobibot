// F0.4 (auditoría 2026-07-01) — un producto público v1.0.0 llevaba embebido
// el nombre de un cliente real ("Alcayna"), un banner de versión falso
// ("ShinobiBot Enterprise Edition - Versión 4.5.1") y rastro textual de un
// rebranding anterior ("OpenGravity"). Este test reproduce el hallazgo:
// falla si cualquiera de esos cuatro términos aparece en CÓDIGO DE PRODUCTO
// (src/, excluyendo __tests__/ y docs/).
//
// __tests__/ se excluye a propósito: los tests que PRUEBAN la ausencia de
// estos términos (p.ej. `expect(x).not.toMatch(/alcayna/i)`) necesariamente
// los mencionan como texto — no son la fuga que este test detecta.
// docs/decisions/ tampoco se escanea: el rastro "OpenGravity" en el registro
// histórico de decisiones (D-015) es historia legítima, no código ejecutable
// (ver F0.4 solución punto 4 del plan de remediación).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(__dirname, '..');

const BANNED_TERMS = ['Alcayna', 'Enterprise Edition', '4.5.1', 'OpenGravity'];

const IGNORE_DIR_SEGMENTS = new Set(['__tests__', 'node_modules', 'dist', 'build']);

function collectProductFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (IGNORE_DIR_SEGMENTS.has(entry)) continue;
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      collectProductFiles(abs, acc);
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
      acc.push(abs);
    }
  }
  return acc;
}

describe('F0.4 — sin branding residual en código de producto (src/, fuera de __tests__/)', () => {
  const files = collectProductFiles(SRC_ROOT);

  it('escanea al menos varios cientos de ficheros (sanity check del propio test)', () => {
    // Si esto falla, el test está escaneando el directorio equivocado —
    // silenciosamente "pasaría en verde" sin comprobar nada.
    expect(files.length).toBeGreaterThan(200);
  });

  for (const term of BANNED_TERMS) {
    it(`ningún fichero de producto contiene "${term}"`, () => {
      const offenders: string[] = [];
      for (const abs of files) {
        const content = readFileSync(abs, 'utf-8');
        if (content.includes(term)) {
          offenders.push(relative(SRC_ROOT, abs));
        }
      }
      expect(offenders, `"${term}" apareció en: ${offenders.join(', ')}`).toEqual([]);
    });
  }
});
