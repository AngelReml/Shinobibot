@echo off
setlocal
echo === Shinobi B12 rebuild ===
echo.

echo [1/4] esbuild bundle...
call node build_sea.mjs
if errorlevel 1 goto :fail

echo.
echo [2/4] SEA blob...
call node --experimental-sea-config sea-config.json
if errorlevel 1 goto :fail

echo.
echo [3/4] copy node.exe -^> build\shinobi.exe...
call node -e "require('fs').copyFileSync(process.execPath, 'build/shinobi.exe')"
if errorlevel 1 goto :fail

echo.
echo [4/4] postject inject...
call npx postject build\shinobi.exe NODE_SEA_BLOB build\shinobi-blob.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
if errorlevel 1 goto :fail

echo.
echo === Done ===
powershell -NoProfile -Command "Get-ChildItem build\shinobi-bundle.cjs,build\shinobi.exe | Select-Object Name,Length"
endlocal
exit /b 0

:fail
echo.
echo === BUILD FAILED ===
endlocal
exit /b 1
