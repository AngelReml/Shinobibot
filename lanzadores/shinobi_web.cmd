@echo off
REM Shinobi Web — Bloque 1. Arranca el servidor web y abre el navegador.
REM El browser se abre en segundo plano tras 2s para dar tiempo al server a levantar.
REM Resuelve la ruta relativa a este .cmd, así funciona desde cualquier carpeta.
start "" cmd /c "timeout /t 2 /nobreak > nul && start http://localhost:3333"
npx tsx "%~dp0..\scripts\shinobi_web.ts" %*
