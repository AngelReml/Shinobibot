// scripts/gen_sbom.ts
//
// P6 (remediación 2026-07-01) — SBOM del artefacto distribuido: lista cada
// dependencia resuelta (nombre, versión, URL de resolución, hash de integridad
// SRI) directamente de package-lock.json (lockfileVersion 3, ya committeado y
// consistente con lo que `npm ci` instala). No inventa hashes ni promete
// reproducibilidad byte-a-byte del .exe — es la definición honesta de
// "verifiable build" para este repo: QUÉ entró al build, no un binario idéntico.
//
// Uso: npx tsx scripts/gen_sbom.ts  →  build/sbom.json

import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import { execSync } from 'child_process';
import pkg from '../package.json' with { type: 'json' };

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, 'build');

interface LockPackage {
  version?: string;
  resolved?: string;
  integrity?: string;
  dev?: boolean;
  license?: string;
}

interface Lockfile {
  lockfileVersion: number;
  packages: Record<string, LockPackage>;
}

function gitCommit(): string {
  try { return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim(); }
  catch { return 'unknown'; }
}

function packageNameFromKey(key: string): string {
  // "node_modules/@scope/name" o "node_modules/foo/node_modules/bar" -> el último segmento con scope.
  const idx = key.lastIndexOf('node_modules/');
  const tail = key.slice(idx + 'node_modules/'.length);
  return tail;
}

function main(): void {
  const lockPath = path.join(ROOT, 'package-lock.json');
  const lock: Lockfile = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
  if (lock.lockfileVersion !== 3) {
    throw new Error(`package-lock.json lockfileVersion inesperado: ${lock.lockfileVersion} (se esperaba 3)`);
  }

  const components = Object.entries(lock.packages)
    .filter(([key]) => key !== '' && key.includes('node_modules/'))
    .map(([key, entry]) => ({
      name: packageNameFromKey(key),
      version: entry.version || 'unknown',
      resolved: entry.resolved || null,
      integrity: entry.integrity || null,
      dev: entry.dev === true,
      license: entry.license || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

  const missingIntegrity = components.filter((c) => !c.integrity).length;

  const sbom = {
    format: 'shinobi-sbom-1',
    generated_at: new Date().toISOString(),
    app: {
      name: pkg.name,
      version: pkg.version,
      git_commit: gitCommit(),
    },
    note: 'Verifiable build: hashes SRI de cada dependencia resuelta (package-lock.json). ' +
          'No es una promesa de binario .exe reproducible byte-a-byte.',
    dependency_count: components.length,
    production_dependency_count: components.filter((c) => !c.dev).length,
    missing_integrity_count: missingIntegrity,
    components,
  };

  fs.mkdirSync(BUILD, { recursive: true });
  const outPath = path.join(BUILD, 'sbom.json');
  fs.writeFileSync(outPath, JSON.stringify(sbom, null, 2), 'utf-8');
  console.log(`[sbom] ${components.length} dependencias (${sbom.production_dependency_count} de producción), ${missingIntegrity} sin hash de integridad.`);
  console.log(`[sbom] → ${outPath}`);
}

main();
