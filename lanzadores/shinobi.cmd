@echo off
REM Lanzador de Shinobi (CLI). Resuelve la ruta relativa a este .cmd,
REM así funciona desde cualquier carpeta donde esté el repo.
npx tsx "%~dp0..\scripts\shinobi.ts" %*
