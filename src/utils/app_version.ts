/**
 * APP_VERSION — single source of truth for the running app version.
 * Reads from package.json at module load so it always tracks the real release,
 * never a copy-pasted literal that drifts on bumps.
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Bundle build (build_exe.ts): esbuild colapsa todo el árbol de módulos a un
// único .cjs en build/, así que `__dirname` dentro del snapshot de pkg ya no
// tiene la profundidad original de src/utils/ — `../../package.json` cae
// fuera del propio repo. __SHINOBI_APP_VERSION__ es un `define` de esbuild
// (solo existe en ese bundle) con el mismo valor que ya lee build_exe.ts de
// package.json — fallback exclusivo del .exe empaquetado, nunca se usa en
// dev/CLI/tests (ahí el require de abajo siempre tiene éxito).
declare const __SHINOBI_APP_VERSION__: string | undefined;

function resolveVersion(): string {
  try {
    const _require = createRequire(import.meta.url);
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = _require(resolve(__dirname, '../../package.json')) as { version: string };
    return pkg.version ?? '0.0.0';
  } catch {
    if (typeof __SHINOBI_APP_VERSION__ !== 'undefined') return __SHINOBI_APP_VERSION__;
    return '0.0.0';
  }
}

export const APP_VERSION: string = resolveVersion();
