@echo off
REM Shinobi Web — Bloque 1. Arranca el servidor web y abre el navegador.
REM El browser se abre en segundo plano tras 2s para dar tiempo al server a levantar.
start "" cmd /c "timeout /t 2 /nobreak > nul && start http://localhost:3333"
npx tsx "C:\Users\angel\Desktop\shinobibot\scripts\shinobi_web.ts" %*
