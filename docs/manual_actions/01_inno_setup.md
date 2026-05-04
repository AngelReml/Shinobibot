# Acción 1 — Instalar Inno Setup + compilar instalador

**Tiempo: ~5 min** (descarga + instalación incluidas)
**Desbloquea**: empaquetado `.exe` distribuible. `verify_release.mjs` pasa el check 7 de skipped → green.

## Pasos

### 1. Descargar e instalar Inno Setup

```powershell
# Opción A — descarga manual
# https://jrsoftware.org/isinfo.php → "Download Inno Setup" → instalar con defaults

# Opción B — winget (si lo tienes)
winget install JRSoftware.InnoSetup
```

Tras la instalación, verifica:

```powershell
# Debería estar en PATH; si no, está en:
# C:\Program Files (x86)\Inno Setup 6\ISCC.exe
ISCC /?
```

### 2. Construir el SEA bundle

Desde la raíz del repo:

```powershell
cd C:\Users\angel\Desktop\shinobibot
node build_sea.mjs
# verifica: build\shinobi.exe debe existir
```

### 3. Compilar el instalador

```powershell
ISCC.exe installer\shinobi.iss
# resultado: installer\Output\ShinobiSetup-1.0.0.exe
```

Si ISCC no está en PATH:

```powershell
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\shinobi.iss
```

### 4. Verificar y mover al directorio del release

```powershell
# Mover al lugar que verify_release y release.yml esperan:
move installer\Output\ShinobiSetup-1.0.0.exe build\
# Sanity check
node scripts\release\verify_release.mjs
# El check 7 ahora debería pasar de "skipped — absent" a "✓ ... (NN bytes)"
```

### 5. Re-disparar el release CI con el .exe incluido

```powershell
# Sólo si quieres añadir el .exe como asset del release v1.0.0 ya publicado:
# GitHub → Actions → Release → Run workflow → version: 1.0.0
```

Alternativamente, el CI lo recoge automáticamente en el siguiente bump de versión si hay un `build\ShinobiSetup-<ver>.exe` presente.

## Qué hace el .iss

Está diseñado para cumplir las reglas de `Tareas..txt B1`:

- App name + version + publisher.
- Install dir = `Program Files\Shinobi\`.
- Acceso directo Escritorio (opcional, opt-in).
- Entrada Menú Inicio (default checked).
- **Auto-start Windows OFF por defecto** — opt-in explícito (cumple la regla "OBS no por defecto" extendida a servicios).
- Si el usuario marca auto-start, ejecuta `scripts\install_service.ps1` que registra `ShinobiDaemon` (tu daemon 24/7 ya construido).
- Uninstaller para el servicio en `[UninstallRun]`.
- Sanity check x64-only.
- Si hay servicio pre-instalado, el setup lo para antes de reemplazar `shinobi.exe` para evitar file-lock.

## Si compilation falla

| Error | Causa probable | Fix |
|---|---|---|
| `File ..\build\shinobi.exe not found` | No corriste `node build_sea.mjs` | Pasos #2 |
| `File ..\build\node_modules\better-sqlite3\*` no encontrado | better-sqlite3 no compilado | `cd build && npm install better-sqlite3` |
| `ISCC: not recognized` | Inno Setup no en PATH | Usar ruta completa: `"C:\Program Files (x86)\Inno Setup 6\ISCC.exe"` |

## Para CI futuro

Si quieres que GitHub Actions compile el .exe en cada release, añade a `release.yml` después del SEA build:

```yaml
- name: Install Inno Setup
  run: choco install innosetup -y --no-progress

- name: Compile installer
  shell: pwsh
  run: |
    & "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\shinobi.iss
    Move-Item installer\Output\*.exe release-artefacts\
```
