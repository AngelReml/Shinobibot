# scripts/install_service.ps1
#
# Registers Shinobi as a Windows service that launches `shinobi daemon` on boot.
# Uses native sc.exe — no NSSM, no third-party dep. Optional: pass -Uninstall to remove.
#
# Run from an *Administrator* PowerShell:
#   .\scripts\install_service.ps1                # install + start
#   .\scripts\install_service.ps1 -Uninstall     # stop + remove
#
# The wrapper batch file scripts/_shinobi_daemon.cmd is created on demand so
# sc.exe has a stable executable path that doesn't depend on PowerShell.

[CmdletBinding()]
param(
    [switch]$Uninstall,
    [string]$ServiceName = 'ShinobiDaemon',
    [string]$DisplayName = 'Shinobi 24/7 resident agent'
)

$ErrorActionPreference = 'Stop'

# Admin check
$me = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = (New-Object Security.Principal.WindowsPrincipal $me).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error 'This script must run as Administrator.'
    exit 1
}

if ($Uninstall) {
    Write-Host "Stopping and removing service $ServiceName..."
    & sc.exe stop $ServiceName 2>$null | Out-Null
    Start-Sleep -Seconds 2
    & sc.exe delete $ServiceName | Out-Host
    exit 0
}

# Resolve repo root from this script's location
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot = Resolve-Path (Join-Path $scriptDir '..') | Select-Object -ExpandProperty Path
$wrapperPath = Join-Path $scriptDir '_shinobi_daemon.cmd'

# Locate node.exe
$nodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) {
    Write-Error 'node.exe not on PATH. Install Node 22+ and re-run.'
    exit 1
}

# Generate the wrapper batch file (sc.exe expects a single executable path)
@"
@echo off
cd /d $repoRoot
$nodeExe %~dp0..\node_modules\.bin\tsx.cmd scripts\shinobi.ts daemon >> "%APPDATA%\Shinobi\daemon.log" 2>&1
"@ | Out-File -Encoding ASCII -FilePath $wrapperPath

Write-Host "Wrapper at: $wrapperPath"
Write-Host "Installing service $ServiceName..."

& sc.exe create $ServiceName binPath= "`"$wrapperPath`"" start= auto DisplayName= "`"$DisplayName`"" | Out-Host
& sc.exe description $ServiceName 'Shinobi headless resident loop. Runs recurring missions and watchers without the interactive CLI.' | Out-Host

# Failure recovery: restart on crash, three escalating delays
& sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Host

Write-Host "Starting service..."
& sc.exe start $ServiceName | Out-Host

Write-Host ''
Write-Host 'Done. Logs: %APPDATA%\Shinobi\daemon.log'
Write-Host 'Stop with: sc.exe stop ShinobiDaemon'
Write-Host 'Remove with: .\scripts\install_service.ps1 -Uninstall'
