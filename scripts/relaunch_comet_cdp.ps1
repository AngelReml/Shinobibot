<#
.SYNOPSIS
  Relanza Comet limpio con remote debugging en :9222 para Shinobi.

.DESCRIPTION
  Incidente 2026-05-16 (docs/incidents/2026-05-16_browser_cdp_regression.md).
  Chromium es de instancia unica: si Comet ya esta abierto SIN el flag
  --remote-debugging-port, no se le puede activar el CDP; abrir el acceso
  directo solo reenvia la orden a esa instancia y descarta el flag.

  Este script hace el ciclo fiable de un tiron:
    1. Cierra TODOS los procesos comet.exe (force).
    2. Espera a que mueran y se libere el lock del perfil.
    3. Relanza Comet con el comando canonico (docs/01_ecosystem.md):
         comet.exe --remote-debugging-port=9222 --no-first-run --no-default-browser-check
    4. Espera a que el puerto 9222 abra y verifica el endpoint CDP.

  Usa el perfil por defecto del usuario (sin --user-data-dir), asi conserva
  las sesiones (Upwork, LinkedIn, Fiverr...).

.PARAMETER Force
  Relanza aunque el puerto 9222 ya este activo. Sin -Force, si el CDP ya
  funciona el script no toca nada.

.NOTES
  ATENCION: cierra Comet a la fuerza. Comet restaura las pestanas al reabrir,
  pero se puede perder texto de formularios sin enviar. No requiere admin.
  Script en ASCII puro a proposito (PowerShell 5.1 lee .ps1 sin BOM como ANSI).
#>
[CmdletBinding()]
param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$CDP_PORT = 9222

function Test-CdpPort {
  [bool](Get-NetTCPConnection -LocalPort $CDP_PORT -State Listen -ErrorAction SilentlyContinue)
}

# --- 1. Localizar comet.exe -------------------------------------------------
$cometCandidates = @(
  'C:\Program Files\Perplexity\Comet\Application\comet.exe',
  (Join-Path $env:LOCALAPPDATA 'Perplexity\Comet\Application\comet.exe')
)
$comet = $cometCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $comet) {
  Write-Error ("comet.exe no encontrado. Buscado en:`n  " + ($cometCandidates -join "`n  "))
  exit 1
}

# --- 2. Ya esta activo? -----------------------------------------------------
if ((Test-CdpPort) -and -not $Force) {
  Write-Host "[OK] El CDP ya esta activo en :$CDP_PORT - nada que hacer."
  Write-Host "     (pasa -Force para relanzar de todos modos)"
  exit 0
}

# --- 3. Cerrar todos los comet.exe -----------------------------------------
$procs = Get-Process comet -ErrorAction SilentlyContinue
if ($procs) {
  Write-Host "[1] Cerrando $(@($procs).Count) procesos comet.exe..."
  $procs | Stop-Process -Force -ErrorAction SilentlyContinue
} else {
  Write-Host "[1] No habia comet.exe en ejecucion."
}

# Esperar a que mueran (y se libere el lock del perfil).
for ($i = 0; $i -lt 20; $i++) {
  if (-not (Get-Process comet -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 250
}
$rem = @(Get-Process comet -ErrorAction SilentlyContinue).Count
if ($rem -gt 0) {
  Write-Error "[2] Quedan $rem procesos comet.exe tras el cierre - abortado."
  exit 1
}
Write-Host "[2] Todos los comet.exe cerrados."
Start-Sleep -Seconds 2   # margen para liberar el singleton lock del perfil

# --- 4. Relanzar con el flag CDP -------------------------------------------
Start-Process -FilePath $comet -ArgumentList @(
  "--remote-debugging-port=$CDP_PORT",
  '--no-first-run',
  '--no-default-browser-check'
)
Write-Host "[3] Comet relanzado con --remote-debugging-port=$CDP_PORT"

# --- 5. Esperar al puerto y verificar CDP ----------------------------------
$ok = $false
for ($i = 1; $i -le 30; $i++) {
  Start-Sleep -Seconds 1
  if (Test-CdpPort) { $ok = $true; Write-Host "[4] Puerto $CDP_PORT ABIERTO tras ${i}s."; break }
}
if (-not $ok) {
  Write-Error "[4] El puerto $CDP_PORT no abrio en 30s."
  exit 1
}

try {
  $v = Invoke-RestMethod "http://localhost:$CDP_PORT/json/version" -TimeoutSec 5
  Write-Host "[5] CDP OK -> $($v.Browser)"
  Write-Host ""
  Write-Host "[LISTO] Shinobi ya puede conectarse al navegador del usuario."
  exit 0
} catch {
  Write-Error "[5] El puerto abrio pero el endpoint CDP no responde: $($_.Exception.Message)"
  exit 1
}
