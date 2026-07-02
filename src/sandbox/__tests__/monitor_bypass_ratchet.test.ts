// P1.E1 (plan de frontera 2026-07-01) — ratchet de arquitectura para el
// Monitor de Referencia Único.
//
// Tesis de P1: NINGÚN efecto de ejecución debe ocurrir esquivando un chokepoint
// único. Hoy eso no se cumple: varios subsistemas llaman `sandboxRegistry().get(id).run()`
// DIRECTO, saltándose cualquier validación central. El criterio de aceptación final
// de P1 es: `grep 'sandboxRegistry' fuera de src/sandbox/` == 0.
//
// Ese cero es el destino, no el presente. Migrar los 8 callers al monitor es trabajo
// de varias etapas (P1.E2). Mientras tanto, este test es un RATCHET (trinquete): fija
// la línea base de callers directos conocidos y falla si aparece UNO NUEVO. Así el
// problema no puede EMPEORAR mientras se migra — un 9º bypass en un fichero nuevo pone
// CI en rojo. Cuando P1.E2 migre un caller, se quita de la base y el trinquete aprieta.
//
// NO es cosmético: es la diferencia entre "sabemos que hay 8 y no crecerán" y "cualquiera
// añade un bypass y nadie se entera". Es el primer incremento verificable de P1.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname, dirname, resolve, relative, sep } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..'); // src/sandbox/__tests__/ -> repo root

// P1.E2 COMPLETADO (2026-07-02): los 8 callers directos de la línea base
// original (chizu/adapters, kagami/adapters, kaname/live, shitsuji/live,
// shugyo/index, shugyo/sandbox/revertible, tools/run_command,
// tools/spawn_agent) migraron a `mediatedEffect()` / `backendConfigured()`
// de src/sandbox/monitor.ts. La base queda VACÍA: el ratchet pasó de modo
// warn (no crecer) a modo blocking (cero usos fuera de src/sandbox/).
// Si necesitas un bypass legítimo, justifícalo en DECISIONES.md — pero la
// respuesta correcta casi siempre es añadir lo que falta al monitor.
const KNOWN_BASELINE = new Set<string>([]);

const NEEDLE = 'sandboxRegistry';

function collectProductTs(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git' || entry === '__tests__') continue;
    const abs = join(dir, entry);
    let s;
    try {
      s = statSync(abs);
    } catch {
      continue;
    }
    if (s.isDirectory()) collectProductTs(abs, acc);
    else if (extname(abs) === '.ts' && !abs.endsWith('.test.ts')) acc.push(abs);
  }
  return acc;
}

function rel(abs: string): string {
  return relative(ROOT, abs).split(sep).join('/');
}

describe('P1.E1 — ratchet de bypass del sandbox (sandboxRegistry fuera de src/sandbox/)', () => {
  // Escanea TODO src/ EXCEPTO src/sandbox/ (donde el uso es legítimo, es su casa).
  const srcRoot = join(ROOT, 'src');
  const files = collectProductTs(srcRoot).filter((abs) => {
    const r = rel(abs);
    return !r.startsWith('src/sandbox/');
  });

  const offenders = files.filter((abs) => readFileSync(abs, 'utf-8').includes(NEEDLE)).map(rel);

  it('escanea un árbol plausible (sanity — evita verde silencioso)', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('ningún caller directo NUEVO de sandboxRegistry fuera de la línea base conocida', () => {
    const nuevos = offenders.filter((f) => !KNOWN_BASELINE.has(f));
    expect(
      nuevos,
      `Bypass NUEVO del monitor de sandbox detectado en: ${nuevos.join(', ')}. ` +
        `Todo efecto de ejecución debe pasar por el chokepoint de P1, no por sandboxRegistry() directo. ` +
        `Si es intencional y aún no migrable, justifícalo en DECISIONES.md y añádelo a KNOWN_BASELINE.`,
    ).toEqual([]);
  });

  it('la línea base no contiene entradas fantasma (ya migradas pero no retiradas)', () => {
    // Si un fichero de la base ya NO usa sandboxRegistry, P1.E2 lo migró: hay que
    // apretar el trinquete quitándolo de KNOWN_BASELINE. Esto evita que la base
    // proteja bypasses inexistentes y enmascare regresiones futuras.
    const offenderSet = new Set(offenders);
    const fantasmas = [...KNOWN_BASELINE].filter((f) => !offenderSet.has(f));
    expect(
      fantasmas,
      `Entradas de KNOWN_BASELINE que ya no usan sandboxRegistry (migradas): ${fantasmas.join(', ')}. ` +
        `Quítalas de la base para apretar el ratchet.`,
    ).toEqual([]);
  });
});
