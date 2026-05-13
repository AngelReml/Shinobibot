// scripts/build_exe.ts
//
// Bloque 9 — Pipeline de compilación a Shinobi.exe + Shinobi-Setup.exe.
//
// Pasos:
//   1. Limpiar build/
//   2. esbuild scripts/shinobi_web.ts → build/shinobi-web.cjs (single CJS bundle)
//   3. Copiar src/web/public/ → build/public/ (pkg lo embebe)
//   4. @yao-pkg/pkg build/shinobi-web.cjs → build/Shinobi.exe (con assets nativos)
//   5. Copiar playwright chromium → build/playwright-browsers/chromium-XXXX/
//   6. Generar build/installer.iss desde la plantilla
//   7. Intentar compilar el installer con ISCC.exe si está instalado
//
// Uso: npx tsx scripts/build_exe.ts

import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import { spawnSync } from 'child_process';
import * as esbuild from 'esbuild';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, 'build');

const APP_VERSION = '2.0.0';

function log(msg: string): void {
  console.log(`[build] ${msg}`);
}

function copyTree(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

function findPlaywrightChromium(): { srcDir: string; version: string } | null {
  const root = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright');
  if (!root || !fs.existsSync(root)) return null;
  const candidates = fs.readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name.startsWith('chromium-') && !e.name.includes('headless'))
    .map(e => e.name);
  if (candidates.length === 0) return null;
  const latest = candidates.sort().reverse()[0];
  return { srcDir: path.join(root, latest), version: latest };
}

function findInnoSetup(): string | null {
  const candidates = [
    'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files (x86)\\Inno Setup 5\\ISCC.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return null;
}

async function step1_clean(): Promise<void> {
  log('1) clean build/');
  fs.rmSync(BUILD, { recursive: true, force: true });
  fs.mkdirSync(BUILD, { recursive: true });
}

async function step2_bundle(): Promise<void> {
  log('2) esbuild shinobi_web.ts → build/shinobi-web.cjs');
  const entry = path.join(ROOT, 'scripts', 'shinobi_web.ts');
  const out = path.join(BUILD, 'shinobi-web.cjs');
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    outfile: out,
    external: [
      'better-sqlite3',
      'sqlite-vec',
      '@nut-tree-fork/nut-js',
      'playwright',
      'playwright-core',
    ],
    // Polyfill de import.meta.url para módulos ESM-style ahora bundleados a CJS:
    // expanding import.meta.url a una const inyectada en el banner que resuelve
    // a la URL del .cjs bundle. Sin esto, fileURLToPath(import.meta.url) tira
    // ERR_INVALID_ARG_TYPE en runtime.
    define: {
      'process.env.NODE_ENV': '"production"',
      'import.meta.url': '__shinobi_meta_url',
    },
    banner: {
      js: 'const __shinobi_meta_url = require("url").pathToFileURL(__filename).toString();',
    },
    logLevel: 'info',
    legalComments: 'none',
  });
  const size = (fs.statSync(out).size / 1024 / 1024).toFixed(2);
  log(`   → ${size} MB`);
}

async function step3_copyPublic(): Promise<void> {
  log('3) copy src/web/public/ → build/public/');
  copyTree(path.join(ROOT, 'src', 'web', 'public'), path.join(BUILD, 'public'));
}

async function step4_pkg(): Promise<void> {
  log('4) @yao-pkg/pkg → build/Shinobi.exe');
  // pkg necesita un package.json en el cwd. Generamos uno mínimo en build/.
  const pkgManifest = {
    name: 'shinobi',
    version: APP_VERSION,
    main: 'shinobi-web.cjs',
    bin: 'shinobi-web.cjs',
    pkg: {
      scripts: ['shinobi-web.cjs'],
      assets: [
        'public/**/*',
        // Native modules — paths relativos a este package.json (en build/)
        '../node_modules/better-sqlite3/build/Release/*.node',
        '../node_modules/better-sqlite3/prebuilds/**/*',
        '../node_modules/sqlite-vec/**/*',
        '../node_modules/@nut-tree-fork/**/*.node',
        '../node_modules/@nut-tree-fork/**/build/Release/*',
      ],
      targets: ['node24-win-x64'],
      outputPath: '.',
    },
  };
  fs.writeFileSync(path.join(BUILD, 'package.json'), JSON.stringify(pkgManifest, null, 2));

  const res = spawnSync('npx', [
    '--yes', '@yao-pkg/pkg', 'package.json',
    '--target', 'node24-win-x64',
    '--output', 'Shinobi.exe',
  ], {
    cwd: BUILD,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) {
    throw new Error(`pkg falló con código ${res.status}`);
  }
  const exePath = path.join(BUILD, 'Shinobi.exe');
  if (!fs.existsSync(exePath)) throw new Error('pkg terminó pero no encontró Shinobi.exe');
  const size = (fs.statSync(exePath).size / 1024 / 1024).toFixed(2);
  log(`   → Shinobi.exe ${size} MB`);
}

async function step5_chromium(): Promise<void> {
  log('5) copy playwright chromium → build/playwright-browsers/');
  const found = findPlaywrightChromium();
  if (!found) {
    log('   ⚠ no se encontró chromium en %LOCALAPPDATA%/ms-playwright/');
    log('   ejecuta `npx playwright install chromium` y reintenta el step 5.');
    return;
  }
  const dest = path.join(BUILD, 'playwright-browsers', found.version);
  log(`   copiando ${found.srcDir} → ${dest} (puede tardar 20-40s)…`);
  const t0 = Date.now();
  copyTree(found.srcDir, dest);
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  const totalSize = totalDirSize(dest) / 1024 / 1024;
  log(`   → ${totalSize.toFixed(0)} MB copiados en ${dur}s`);
}

function totalDirSize(dir: string): number {
  let sum = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) sum += totalDirSize(p);
    else sum += fs.statSync(p).size;
  }
  return sum;
}

async function step6_installerScript(): Promise<void> {
  log('6) generar build/installer.iss');
  const iss = `; installer.iss — generado por scripts/build_exe.ts
; Compilar con: "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe" installer.iss

#define MyAppName "Shinobi"
#define MyAppVersion "${APP_VERSION}"
#define MyAppPublisher "AngelReml"
#define MyAppURL "https://github.com/AngelReml/Shinobibot"
#define MyAppExeName "Shinobi.exe"

[Setup]
AppId={{B3F4C5E6-7A8B-4C9D-A0E1-1F2A3B4C5D6E}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={autopf}\\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=.
OutputBaseFilename=Shinobi-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\\Spanish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "Shinobi.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "playwright-browsers\\*"; DestDir: "{app}\\playwright-browsers"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\\{#MyAppName}"; Filename: "{app}\\{#MyAppExeName}"
Name: "{group}\\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\\{#MyAppName}"; Filename: "{app}\\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent
`;
  fs.writeFileSync(path.join(BUILD, 'installer.iss'), iss);
  log('   → build/installer.iss');
}

async function step7_innoSetup(): Promise<void> {
  log('7) compilar installer (Inno Setup)');
  const iscc = findInnoSetup();
  if (!iscc) {
    log('   ⚠ Inno Setup no encontrado. Instálalo desde https://jrsoftware.org/isdl.php');
    log('   Después ejecuta manualmente:');
    log(`   "${'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe'}" "${path.join(BUILD, 'installer.iss')}"`);
    return;
  }
  log(`   usando ${iscc}`);
  const res = spawnSync(iscc, ['installer.iss'], {
    cwd: BUILD,
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    throw new Error(`ISCC falló con código ${res.status}`);
  }
  const setupPath = path.join(BUILD, 'Shinobi-Setup.exe');
  if (fs.existsSync(setupPath)) {
    const size = (fs.statSync(setupPath).size / 1024 / 1024).toFixed(1);
    log(`   ✓ Shinobi-Setup.exe ${size} MB`);
  }
}

async function main() {
  const t0 = Date.now();
  await step1_clean();
  await step2_bundle();
  await step3_copyPublic();
  await step4_pkg();
  await step5_chromium();
  await step6_installerScript();
  await step7_innoSetup();
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n[build] ✓ completado en ${dur}s\n`);
  console.log(`[build] Artifacts en ${BUILD}:`);
  for (const entry of fs.readdirSync(BUILD)) {
    const p = path.join(BUILD, entry);
    const stat = fs.statSync(p);
    if (stat.isFile()) {
      const size = (stat.size / 1024 / 1024).toFixed(2);
      console.log(`  · ${entry.padEnd(28)} ${size} MB`);
    } else {
      console.log(`  · ${entry}/`);
    }
  }
}

main().catch(err => {
  console.error('\n[build] FATAL:', err.message || err);
  process.exit(1);
});
