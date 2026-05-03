$config = "$env:APPDATA\Shinobi\config.json"
$backup = "$env:APPDATA\Shinobi\config.backup.b12.json"

if (Test-Path $config) { Copy-Item $config $backup -Force }
Remove-Item $config -Force -ErrorAction SilentlyContinue

$exe = "C:\Users\angel\Desktop\shinobibot\build\shinobi.exe"
@('es', 'sk_dev_master', '') | & $exe 2>&1 | Select-Object -First 30

if (Test-Path $config) {
  Write-Output "`n--- CONFIG GENERATED ---"
  Get-Content $config
} else {
  Write-Output "`n--- CONFIG NOT CREATED ---"
}

if (Test-Path $backup) {
  Copy-Item $backup $config -Force
  Remove-Item $backup -Force
}
