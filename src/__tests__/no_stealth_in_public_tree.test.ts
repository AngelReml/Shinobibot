// F6.1 (auditoría 2026-07-01, decisión de producto) — el árbol público
// alojaba evasión anti-bot deliberada (spoofing de navigator.webdriver,
// chrome.runtime falso, plugins falsos, WebGL vendor/renderer) y 27 scripts
// de automatización de sesiones logueadas de terceros (LinkedIn, Upwork,
// Fiverr, Gemini, NotebookLM). Se retiraron del producto público — ver
// DECISIONES.md (F6.1) y el archivo entregado al operador con el código y
// los scripts originales para su uso privado.
//
// Este test es el "check de CI" que el plan de remediación pedía
// explícitamente: falla si alguien reintroduce el patrón de stealth en el
// árbol público. Excluye __tests__/ (este mismo fichero necesita nombrar
// el patrón para poder buscarlo) y docs/ (historia legítima).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(__dirname, '..');

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

// Firmas de stealth/anti-detección (no confundir con detección de bloqueo,
// que SÍ es legítima — web_search_with_warmup.ts detecta que LE bloquearon,
// no falsifica el fingerprint del navegador).
const STEALTH_SIGNATURES = [
  'navigator.webdriver',
  'STEALTH_INIT_SCRIPT',
  'applyStealth',
  'chrome.runtime',
];

describe('F6.1 — sin evasión anti-bot (stealth) en código de producto público', () => {
  const files = collectProductFiles(SRC_ROOT);

  it('escanea al menos varios cientos de ficheros (sanity check del propio test)', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  for (const sig of STEALTH_SIGNATURES) {
    it(`ningún fichero de producto contiene la firma de stealth "${sig}"`, () => {
      const offenders: string[] = [];
      for (const abs of files) {
        const content = readFileSync(abs, 'utf-8');
        if (content.includes(sig)) offenders.push(relative(SRC_ROOT, abs));
      }
      expect(offenders, `"${sig}" apareció en: ${offenders.join(', ')}`).toEqual([]);
    });
  }

  it('web_search_with_warmup no promociona plataformas concretas en su descripción (Fiverr/Upwork/LinkedIn)', () => {
    const content = readFileSync(join(SRC_ROOT, 'tools', 'web_search_with_warmup.ts'), 'utf-8');
    // El código (comentarios explicando la retirada) puede mencionar los
    // nombres históricamente — lo que no debe volver es la DESCRIPCIÓN de
    // la tool (el string que ve el LLM) recomendándola para esas plataformas.
    const descMatch = content.match(/description:\s*'([^']*)'/);
    expect(descMatch, 'no se encontró el campo description de la tool').toBeTruthy();
    expect(descMatch![1]).not.toMatch(/fiverr|upwork|linkedin/i);
  });
});
