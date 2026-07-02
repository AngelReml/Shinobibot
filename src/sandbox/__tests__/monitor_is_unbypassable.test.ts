// P1.E2 (plan de frontera 2026-07-01) — test de mutación del plan:
// `monitor_is_unbypassable.test.ts`.
//
// Tres propiedades del reference monitor, cada una con su mutación:
//
//   1. COMPLETITUD (arquitectura): ningún fichero de producto fuera de
//      src/sandbox/ toca `sandboxRegistry`. Mutación: añadir un caller
//      sintético bajo src/ → rojo (aquí Y en el ratchet, doble guardia).
//      El scanner se auto-verifica contra un árbol fixture con un bypass
//      plantado: si el sensor no detecta ni eso, el test se delata como
//      decorativo en vez de dar verde silencioso.
//   2. CHOKEPOINT VIVO (no decorativo): `mediatedEffect` ejecuta de verdad
//      a través del backend resuelto. Mutación: romper la resolución → rojo.
//   3. FAIL-CLOSED en las fronteras: mandato presente SIN la capacidad ⇒
//      denegado (E3.a, capability_not_granted); kind no-shell (E4/E5) ⇒ denegado;
//      efecto malformado ⇒ denegado; backend desconocido ⇒ denegado sin fallback.
//      Mutación: ignorar el mandato en silencio → rojo.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, extname, dirname, resolve, relative, sep } from 'path';
import { fileURLToPath } from 'url';
import * as os from 'node:os';
import { mediatedEffect, backendConfigured, monitorStats, _resetMonitorStats } from '../monitor.js';
import { sandboxRegistry, _resetSandboxRegistry, MockBackend } from '../registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');

// Mismas reglas de exclusión que el ratchet (monitor_bypass_ratchet.test.ts):
// producto = .ts fuera de __tests__/node_modules/dist/.git, sin *.test.ts.
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

function scanOffenders(srcRoot: string, excludePrefix: string): string[] {
  return collectProductTs(srcRoot)
    .filter((abs) => !relative(dirname(srcRoot), abs).split(sep).join('/').startsWith(excludePrefix))
    .filter((abs) => readFileSync(abs, 'utf-8').includes('sandboxRegistry'))
    .map((abs) => relative(dirname(srcRoot), abs).split(sep).join('/'));
}

describe('P1 — completitud: nadie fuera de src/sandbox/ toca el registry', () => {
  it('el sensor detecta un bypass sintético plantado en un árbol fixture', () => {
    const tmp = mkdtempSync(join(os.tmpdir(), 'shinobi_fixture_'));
    try {
      mkdirSync(join(tmp, 'src', 'evil'), { recursive: true });
      writeFileSync(
        join(tmp, 'src', 'evil', 'bypass.ts'),
        `import { sandboxRegistry } from '../sandbox/registry.js';\n` +
          `export const b = sandboxRegistry().get('local');\n`,
      );
      const offenders = scanOffenders(join(tmp, 'src'), 'src/sandbox/');
      expect(offenders, 'el sensor NO ve el bypass plantado: scanner roto/decorativo').toEqual(['src/evil/bypass.ts']);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('árbol real: CERO usos de sandboxRegistry fuera de src/sandbox/ (P1.E2 blocking)', () => {
    const offenders = scanOffenders(join(ROOT, 'src'), 'src/sandbox/');
    expect(
      offenders,
      `Bypass del monitor: ${offenders.join(', ')}. Todo efecto pasa por mediatedEffect() — sin excepciones sin entrada en DECISIONES.md.`,
    ).toEqual([]);
  });
});

describe('P1 — chokepoint vivo y fail-closed', () => {
  beforeEach(() => {
    _resetSandboxRegistry();
    _resetMonitorStats();
  });
  afterEach(() => {
    _resetSandboxRegistry();
  });

  it('mediatedEffect EJECUTA vía el backend resuelto (no es un stub)', async () => {
    let ran = 0;
    sandboxRegistry().register(
      new MockBackend({
        id: 'mock',
        scriptedOutput: () => {
          ran++;
          return { stdout: 'ejecutado', stderr: '', exitCode: 0 };
        },
      }),
    );
    const res = await mediatedEffect({
      kind: 'shell',
      rawCommandLine: true,
      target: 'lo que sea',
      cwd: process.cwd(),
      timeoutMs: 5_000,
      backendId: 'mock',
      reversible: false,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.run.stdout).toBe('ejecutado');
      expect(res.run.backend).toBe('mock');
    }
    expect(ran).toBe(1);
    expect(monitorStats().mediated).toBe(1);
  });

  it('mandato presente que NO cubre el efecto ⇒ capability_not_granted, NO ejecuta (E3.a)', async () => {
    let ran = 0;
    sandboxRegistry().register(new MockBackend({ id: 'mock', scriptedOutput: () => { ran++; return { stdout: '', stderr: '', exitCode: 0 }; } }));
    const res = await mediatedEffect(
      {
        kind: 'shell',
        rawCommandLine: true,
        target: 'echo hola',
        cwd: process.cwd(),
        timeoutMs: 5_000,
        backendId: 'mock',
        reversible: false,
      },
      { capabilities: ['fs.read:/nada'] }, // un mandato que NO cubre un efecto shell
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('capability_not_granted');
    expect(ran).toBe(0);                        // el efecto NO llegó al backend
    expect(monitorStats().denied).toBe(1);
    expect(monitorStats().mediated).toBe(0);
  });

  it('kinds declarados pero sin mediación real (fs/net/input) ⇒ DENEGADOS', async () => {
    for (const kind of ['fs.read', 'fs.write', 'net', 'input'] as const) {
      const res = await mediatedEffect({ kind, target: 'x', reversible: false });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('unsupported_kind');
    }
  });

  it('rawCommandLine + args a la vez ⇒ invalid_effect (o crudo o argv, no ambos)', async () => {
    const res = await mediatedEffect({
      kind: 'shell',
      rawCommandLine: true,
      target: 'echo',
      args: ['x'],
      cwd: process.cwd(),
      timeoutMs: 5_000,
      reversible: false,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('invalid_effect');
  });

  it('backend desconocido ⇒ backend_unavailable, JAMÁS fallback silencioso a local', async () => {
    const res = await mediatedEffect({
      kind: 'shell',
      rawCommandLine: true,
      target: 'echo hola',
      cwd: process.cwd(),
      timeoutMs: 5_000,
      backendId: 'inexistente',
      reversible: false,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('backend_unavailable');
      expect(res.detail).toContain('inexistente');
    }
  });

  it('backendConfigured: probe read-only coherente con el registry', () => {
    expect(backendConfigured('local')).toBe(true);       // siempre registrado y configurado
    expect(backendConfigured('inexistente')).toBe(false); // desconocido
  });
});
