<#
  Test emulator for functions.test.js: project demo-bunnbaa-test, on ports that don't clash with the dev
  emulator (dev-local.ps1), so both can run at once and tests never touch dev data. After startup it seeds
  menus and recipes automatically (seed-phase1.js --catalog-only).

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts\tests\emulator.ps1
  The emulator hangs under a path with Chinese characters, so like dev-local.ps1 it runs from an ASCII junction.
#>
param(
  [string]$Junction = "C:\Users\USER\bunnbaa-dev",
  [switch]$NoSeed
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path $Junction)) {
  $repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
  Write-Host "找不到 junction $Junction，請先在 cmd 執行：mklink /J $Junction `"$repo`"" -ForegroundColor Red
  exit 1
}
# Config is firebase.test.json at the repo root (rules/functions paths can't be outside the config file's directory)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$Junction'; firebase emulators:start --config firebase.test.json --only functions,firestore,auth --project demo-bunnbaa-test" | Out-Null
Write-Host "測試 emulator 啟動中（另一個視窗）…" -ForegroundColor Cyan

$deadline = (Get-Date).AddSeconds(180)
while ((Get-Date) -lt $deadline) {
  try { $c = New-Object System.Net.Sockets.TcpClient; $c.Connect("127.0.0.1", 5002); $c.Close(); break } catch { Start-Sleep -Seconds 2 }
}
if ($NoSeed) { exit 0 }
$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8081"
$env:FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9098"
$env:GCLOUD_PROJECT = "demo-bunnbaa-test"
Remove-Item Env:GOOGLE_APPLICATION_CREDENTIALS -ErrorAction SilentlyContinue
# Seed only menus, recipes, the dish library and platform settings; tests create their own orders. The full seed
# (about 3,600 orders) would queue onLockCreated and other triggers for hours, and tests would never see their own.
Push-Location (Join-Path $Junction "scripts")
node seed-phase1.js --catalog-only
Pop-Location
Write-Host "菜單與配方已灌入，可以跑 npm run test:functions。" -ForegroundColor Green
