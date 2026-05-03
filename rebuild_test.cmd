@echo off
setlocal
echo === Shinobi B12 wizard test ===
echo.

if not exist build\shinobi.exe (
  echo ERROR: build\shinobi.exe no existe. Ejecuta rebuild.cmd primero.
  exit /b 1
)

echo [1/4] backup config y limpiar...
powershell -NoProfile -Command "if (Test-Path $env:APPDATA\Shinobi\config.json) { Copy-Item $env:APPDATA\Shinobi\config.json $env:APPDATA\Shinobi\config.test.bak -Force; Remove-Item $env:APPDATA\Shinobi\config.json -Force; Write-Output 'config existente respaldado' } else { Write-Output 'no habia config previo' }"

echo.
echo [2/4] preparar input...
> build\__input.txt (
  echo es
  echo sk_dev_master
  echo.
)

echo.
echo [3/4] ejecutar wizard...
echo --- exe output ---
type build\__input.txt | build\shinobi.exe 2>&1
echo --- end exe output ---

echo.
echo [4/4] verificar config...
powershell -NoProfile -Command "if (Test-Path $env:APPDATA\Shinobi\config.json) { Write-Host 'CONFIG OK:' -ForegroundColor Green; Get-Content $env:APPDATA\Shinobi\config.json -Raw } else { Write-Host 'CONFIG NO CREADO' -ForegroundColor Red }"

echo.
echo [5/5] restaurar y limpiar...
powershell -NoProfile -Command "if (Test-Path $env:APPDATA\Shinobi\config.test.bak) { Move-Item $env:APPDATA\Shinobi\config.test.bak $env:APPDATA\Shinobi\config.json -Force; Write-Output 'config original restaurado' }"
del /Q build\__input.txt 2>nul
echo.
endlocal
exit /b 0
