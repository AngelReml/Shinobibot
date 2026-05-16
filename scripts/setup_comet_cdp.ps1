<#
.SYNOPSIS
  Opción A del incidente 2026-05-16 (docs/incidents/2026-05-16_browser_cdp_regression.md):
  restaura el arranque de Comet con CDP para que Shinobi pueda conectarse al
  navegador del usuario y reusar sus sesiones (Upwork, LinkedIn, Fiverr...).

.DESCRIPTION
  Crea un acceso directo "Comet (CDP 9222).lnk" cuyo Target es el comando
  canónico documentado en docs/01_ecosystem.md:

    comet.exe --remote-debugging-port=9222 --no-first-run --no-default-browser-check

  Lo coloca en DOS sitios:
    - Escritorio  -> el usuario abre Comet siempre por aquí.
    - Inicio (Startup) -> Comet arranca con CDP automáticamente al iniciar sesión.

  Es idempotente: sobrescribe los .lnk si ya existen. No mata ni reinicia Comet
  (eso es decisión del usuario — perdería sus pestañas).

.NOTES
  No requiere privilegios de administrador (escribe en carpetas del usuario).
  Comet usa su perfil por defecto (el del usuario, con las sesiones abiertas);
  por eso NO se pasa --user-data-dir.
#>

$ErrorActionPreference = 'Stop'

# --- 1. Localizar comet.exe -------------------------------------------------
$cometCandidates = @(
  'C:\Program Files\Perplexity\Comet\Application\comet.exe',          # install per-machine
  (Join-Path $env:LOCALAPPDATA 'Perplexity\Comet\Application\comet.exe') # install per-user
)
$comet = $cometCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $comet) {
  Write-Error ("comet.exe no encontrado. Buscado en:`n  " + ($cometCandidates -join "`n  "))
  exit 1
}

# --- 2. Definir el acceso directo ------------------------------------------
$cdpArgs   = '--remote-debugging-port=9222 --no-first-run --no-default-browser-check'
$linkName  = 'Comet (CDP 9222).lnk'
$workDir   = Split-Path $comet -Parent
$locations = @(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('Startup')
)

# --- 3. Crear los .lnk ------------------------------------------------------
$shell = New-Object -ComObject WScript.Shell
foreach ($dir in $locations) {
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $linkPath = Join-Path $dir $linkName
  $sc = $shell.CreateShortcut($linkPath)
  $sc.TargetPath       = $comet
  $sc.Arguments        = $cdpArgs
  $sc.WorkingDirectory = $workDir
  $sc.IconLocation     = "$comet,0"
  $sc.Description      = 'Comet con remote debugging en :9222 para Shinobi (incidente 2026-05-16)'
  $sc.WindowStyle      = 1
  $sc.Save()
  Write-Host "[OK] acceso directo creado: $linkPath"
}

Write-Host ''
Write-Host "Target : $comet"
Write-Host "Args   : $cdpArgs"
Write-Host ''

# --- 4. Diagnóstico del estado actual --------------------------------------
$portOpen     = [bool](Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue)
$cometRunning = [bool](Get-Process comet -ErrorAction SilentlyContinue)
Write-Host 'Estado actual:'
Write-Host "  puerto 9222 escuchando : $portOpen"
Write-Host "  comet.exe en ejecucion : $cometRunning"

if ($portOpen) {
  Write-Host ''
  Write-Host '[LISTO] El CDP ya esta activo en :9222 — Shinobi puede conectarse.'
} elseif ($cometRunning) {
  Write-Host ''
  Write-Host '[ACCION REQUERIDA] Comet esta abierto SIN remote debugging.'
  Write-Host 'Los accesos directos NO afectan a la instancia ya abierta.'
  Write-Host 'Para activar el CDP ahora: cierra Comet por completo (revisa la'
  Write-Host 'bandeja del sistema) y reabrelo con el acceso directo del Escritorio'
  Write-Host "'Comet (CDP 9222)'. En el proximo reinicio se hara solo (Startup)."
} else {
  Write-Host ''
  Write-Host '[INFO] Comet no esta abierto. Abrelo con el acceso directo'
  Write-Host "'Comet (CDP 9222)' del Escritorio y el CDP quedara activo en :9222."
}
