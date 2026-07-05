// F0.1 — package.json es la única fuente de verdad de versión. Este test
// verifica que los 3 puntos de entrada que antes tenían el literal "2.0.0"
// hardcodeado (scripts/shinobi_web.ts, scripts/build_exe.ts y su plantilla
// .iss generada) ahora leen realmente de package.json. El instalador vive
// como plantilla generada en build/installer.iss (scripts/build_exe.ts,
// paso 6) — ya no hay un .iss estático committeado desde que se retiró la
// ruta SEA (ver DECISIONES.md, P6).
//
// No podemos `import` scripts/shinobi_web.ts ni scripts/build_exe.ts
// directamente: ambos ejecutan un `main()` con side-effects reales al cargar
// el módulo (acquireLock, spawnSync de pkg/esbuild, etc.). En su lugar
// inspeccionamos el código fuente como texto — suficiente para verificar que
// el APP_VERSION que usan proviene de `import pkg from '../package.json'`
// y no de un literal copiado a mano.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import pkgJson from '../../../package.json' with { type: 'json' };
import { APP_VERSION } from '../app_version.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');

function read(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), 'utf-8');
}

describe('version consistency (F0.1)', () => {
  it('package.json.version is the single source of truth (non-empty semver-ish string)', () => {
    expect(pkgJson.version).toBeTruthy();
    expect(pkgJson.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('src/utils/app_version.ts APP_VERSION matches package.json.version', () => {
    expect(APP_VERSION).toBe(pkgJson.version);
  });

  it('scripts/shinobi_web.ts derives APP_VERSION from package.json, not a hardcoded literal', () => {
    const src = read('scripts/shinobi_web.ts');
    expect(src).toMatch(/import\s+pkg\s+from\s+['"]\.\.\/package\.json['"]/);
    expect(src).toMatch(/const\s+APP_VERSION\s*=\s*pkg\.version/);
    // Regression guard: no more hand-copied version literals like '2.0.0'.
    expect(src).not.toMatch(/const\s+APP_VERSION\s*=\s*['"]\d+\.\d+\.\d+['"]/);
  });

  it('scripts/build_exe.ts derives APP_VERSION from package.json, not a hardcoded literal', () => {
    const src = read('scripts/build_exe.ts');
    expect(src).toMatch(/import\s+pkg\s+from\s+['"]\.\.\/package\.json['"]/);
    expect(src).toMatch(/const\s+APP_VERSION\s*=\s*pkg\.version/);
    expect(src).not.toMatch(/const\s+APP_VERSION\s*=\s*['"]\d+\.\d+\.\d+['"]/);
  });

  it('scripts/build_exe.ts generates its .iss template with MyAppVersion interpolated from APP_VERSION (not hardcoded)', () => {
    const src = read('scripts/build_exe.ts');
    // The generated Inno Setup template string must reference the APP_VERSION
    // variable via template interpolation, e.g. `#define MyAppVersion "${APP_VERSION}"`.
    expect(src).toMatch(/#define MyAppVersion "\$\{APP_VERSION\}"/);
  });

  it('no scripts/ file contains a stray "2.0.0" literal (the historical drift value)', () => {
    // Regression guard for the original F0.1 bug: shinobi_web.ts and
    // build_exe.ts both hardcoded '2.0.0' while package.json said '1.0.0'.
    const files = ['scripts/shinobi_web.ts', 'scripts/build_exe.ts'];
    for (const f of files) {
      const content = read(f);
      expect(content, `${f} should not contain the stale "2.0.0" literal`).not.toContain('2.0.0');
    }
  });

  it('src/web/server.ts derives the onboarding config version default from APP_VERSION, not a hardcoded literal', () => {
    // A full-tree "2.0.0" grep is too blunt for src/ — it false-positives on
    // legitimate semver-range documentation (e.g. plugin_manifest.ts's
    // "^1.2.3 -> >=1.2.3 <2.0.0" comment). Instead this asserts precisely on
    // the one real finding: src/web/server.ts's onboarding handler used to
    // default ShinobiConfig.version to a hand-copied literal instead of the
    // single source of truth. Mirrors the targeted checks above.
    const src = read('src/web/server.ts');
    expect(src).toMatch(/import\s*\{\s*APP_VERSION\s*\}\s*from\s*['"]\.\.\/utils\/app_version\.js['"]/);
    expect(src).toMatch(/version:\s*prev\?\.version\s*\|\|\s*APP_VERSION/);
  });
});
