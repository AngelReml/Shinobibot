@echo off
chcp 65001 >nul
title Apagar Shinobi
echo.
echo  Buscando Shinobi (puerto 3333)...
echo.

set "FOUND="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3333" ^| findstr LISTENING') do (
    set "FOUND=1"
    echo  Cerrando proceso PID %%a ...
    taskkill /F /PID %%a >nul 2>&1
)

if defined FOUND (
    echo.
    echo  Shinobi detenido correctamente.
) else (
    echo  No habia ningun Shinobi escuchando en el puerto 3333.
    echo  (Ya estaba apagado.)
)

echo.
echo  Puedes cerrar esta ventana.
timeout /t 5 >nul
