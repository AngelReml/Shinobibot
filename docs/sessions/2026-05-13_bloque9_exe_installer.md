# Bloque 9 — Shinobi.exe + Inno Setup installer (2026-05-13)

## Qué se entrega

Pipeline completo de empaquetado a `Shinobi.exe` (Windows x64) + un
`Shinobi-Setup.exe` que instala todo con acceso directo en el menú
inicio y desinstalador limpio.

```
npm run build:exe
```

produce en `build/`:

- `Shinobi.exe` 139 MB — binario único con runtime de Node 24, código
  del proyecto bundled a CJS, public/ web embebido, módulos nativos
  (better-sqlite3, sqlite-vec, nut-tree-fork).
- `playwright-browsers/chromium-1217/chrome-win64/` 407 MB — Chromium
  para los skills de navegador, copiado del cache de Playwright.
- `Shinobi-Setup.exe` 167 MB — installer Inno Setup comprimido con
  LZMA2 que incluye todo, crea shortcuts, registra uninstaller.

## Decisiones aplicadas (A/B/C)

- **A.i** `@yao-pkg/pkg` (fork mantenido de `vercel/pkg`). Mismas opciones,
  Node 24 soportado. Compatible con la config existente.
- **B.ii** Playwright Chromium **incluido** vía sibling folder en el
  installer. No se embebe en el `.exe` directamente porque pkg embebiendo
  400+ MB de binarios es lento e inestable. En su lugar, Inno Setup
  bundle todo y deja `playwright-browsers/` junto al `.exe` en
  `Program Files\Shinobi\`. El `.exe` setea `PLAYWRIGHT_BROWSERS_PATH`
  automáticamente a esa ruta si la encuentra.
- **C.ii** Installer profesional con Inno Setup — shortcuts en menú
  inicio + desktop opcional, uninstaller, idioma español + inglés.

## Archivos nuevos

| Archivo | Propósito |
|---|---|
| `scripts/build_exe.ts` | Pipeline en 7 pasos: clean → esbuild bundle CJS → copia public/ → pkg → copia Chromium → genera installer.iss → ejecuta ISCC. |
| `docs/sessions/2026-05-13_bloque9_exe_installer.md` | Este documento. |

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `package.json` | Nueva devDep `@yao-pkg/pkg`. Nuevo script `build:exe`. |
| `src/web/server.ts` | `StartWebServerOptions.publicPath` opcional. `express.static` y `res.sendFile('onboarding.html')` lo usan. Cuando se omite, usa el comportamiento legacy (`path.join(__dirname, 'public')`). |
| `scripts/shinobi_web.ts` | Detecta `process.pkg`. En modo pkg: extrae `public/` del snapshot a `%APPDATA%/Shinobi/runtime/public` (idempotente, vía `.version`), setea `PLAYWRIGHT_BROWSERS_PATH` al `playwright-browsers/` hermano del `.exe`, abre el navegador automáticamente con `start http://localhost:3333`. En dev (`tsx`) sigue igual que antes. |

## El pipeline paso a paso

### 1. clean
`fs.rmSync(build, { recursive: true })` + `mkdirSync`.

### 2. esbuild → CJS bundle
```
esbuild scripts/shinobi_web.ts
  --bundle --platform=node --target=node24 --format=cjs
  --outfile=build/shinobi-web.cjs
  --external:better-sqlite3 --external:sqlite-vec
  --external:@nut-tree-fork/nut-js --external:playwright --external:playwright-core
```

**Fix crítico**: el proyecto es ESM (`"type": "module"`) y usa
`fileURLToPath(import.meta.url)` en varios módulos para obtener
`__filename`. En CJS, `import.meta.url` no existe → esbuild lo
sustituye por `void 0`/empty → `fileURLToPath(undefined)` peta al
arrancar el `.exe`.

Solución: `define: { 'import.meta.url': '__shinobi_meta_url' }` +
banner que inyecta `const __shinobi_meta_url = require("url").pathToFileURL(__filename).toString();`
al top del bundle. Cada módulo cree que su `import.meta.url` es la URL
del bundle CJS — funciona porque ningún módulo usa esa URL para
encontrar siblings (solo para `__filename`/`__dirname`).

### 3. copy public/
`copyTree(src/web/public, build/public)`. Embebido por pkg vía
`pkg.assets: ['public/**/*']`.

### 4. pkg compile
Genera `build/package.json` minimal con la config de pkg, luego:
```
npx @yao-pkg/pkg package.json --target node24-win-x64 --output Shinobi.exe
```
Native modules incluidos via `pkg.assets` referenciando `node_modules/`
con paths relativos a `build/package.json` (`../node_modules/...`).

### 5. copy Chromium
Localiza `%LOCALAPPDATA%\ms-playwright\chromium-*` (no headless), copia
a `build/playwright-browsers/chromium-XXXX/`. 407 MB / ~2s con disco SSD.

### 6. write installer.iss
Plantilla Inno Setup hardcodeada en `build_exe.ts`: nombre, versión,
shortcuts, ficheros, idiomas (spanish + english), run-after-install.

### 7. ISCC.exe
Localiza Inno Setup en `Program Files (x86)\Inno Setup 6\` o en
`%LOCALAPPDATA%\Programs\Inno Setup 6\`. Si no está, imprime
instrucciones para instalar (https://jrsoftware.org/isdl.php). Si está,
ejecuta `iscc.exe installer.iss` → produce `Shinobi-Setup.exe`.

## Comportamiento del .exe en runtime

1. Detección `process.pkg !== undefined`.
2. Primera ejecución: extrae `public/` del snapshot a
   `%APPDATA%\Shinobi\runtime\public\`. Idempotente vía `.version`.
3. `PLAYWRIGHT_BROWSERS_PATH = <dirname(execPath)>\playwright-browsers`
   si existe la carpeta hermana. Sin esa carpeta, los skills de
   browser no funcionan pero el chat sí.
4. Si hay config (`%APPDATA%\Shinobi\config.json`), carga env vars.
   Si no, server arranca igualmente — la pantalla de onboarding del
   Bloque 7 le pide al usuario su provider + API key.
5. `startWebServer` con `publicPath: <APPDATA>\Shinobi\runtime\public`.
6. Tras 800ms abre navegador con `start http://localhost:3333`.
7. Banner verde en la consola. Usuario cierra la ventana o Ctrl+C
   para detener.

## Gotchas resueltos durante el build

- **NODE_MODULE_VERSION mismatch**: `better-sqlite3.node` se compila
  contra la versión de Node instalada en el dev machine. Inicialmente
  apuntamos pkg a `node22-win-x64` pero el dev tenía Node 24 → ABI
  mismatch (`NODE_MODULE_VERSION 137 vs 127`). Fix: target
  `node24-win-x64`. Para releases sería mejor un build farm que
  compile `better-sqlite3` específicamente contra Node 22 si queremos
  reducir el peso (la base de Node 24 es ~40 MB vs ~35 MB de Node 22).

- **build/ locked al re-buildear**: si una ejecución anterior dejó el
  `Shinobi.exe` o procesos pkg vivos, el `fs.rmSync(build)` falla.
  Solución durante dev: matar procesos node residual + retry.

- **playwright-core auto-embedido por pkg**: pkg detecta
  `require('playwright')` en el bundle (que dejamos como external) y
  intenta bundlear playwright-core entero, incluyendo PNGs binarios.
  Genera warnings pero termina. El módulo NO va dentro del .exe porque
  está marcado external en esbuild — solo el shim require resta. En
  runtime, playwright se carga desde el `playwright-browsers/` hermano.

## Verificación

- `npm run build:exe` end-to-end produce los 2 ejecutables.
- `./build/Shinobi.exe` arranca, sirve HTTP 200 en `/`, abre browser.
- Regresión test_bloque8_3 **3/3 PASS** tras los cambios en server.ts.

## Distribución

Para publicar una release:

1. `npm run build:exe`
2. Subir `build/Shinobi-Setup.exe` (167 MB) a GitHub Releases
3. Opcional: subir también `build/Shinobi.exe` (139 MB) para usuarios
   que quieran solo el binario (sin Chromium = sin skills de browser).

El usuario:
- Descarga `Shinobi-Setup.exe`
- Doble-click → wizard de instalación (idioma → directorio → tarea
  "crear icono en escritorio" → install)
- Acceso directo en menú inicio + opcional desktop
- Al cerrar el wizard: opción "Iniciar Shinobi ahora"
- Shinobi arranca, abre navegador, pantalla de onboarding si es 1ª vez

## Deuda

- **No code-signed**: los Windows SmartScreen avisarán al ejecutar.
  Para una distribución pública seria, conviene firmar el `.exe` y el
  `Shinobi-Setup.exe` con un certificado de code-signing (~$80-200/año).
- **Auto-update**: ahora cada release el usuario reinstala. Para v2
  considerar electron-updater o similar.
- **macOS / Linux**: solo Windows x64. pkg soporta otros targets;
  añadirlos al script si el alcance lo pide.
