<#
  functions.test.js 用的測試 emulator：專案 demo-bunnbaa-test，埠號與開發用 emulator（dev-local.ps1）錯開，
  兩個可以同時開，測試不會動到開發資料。啟動後自動灌菜單與配方（seed-phase1.js --catalog-only）。

  用法：
    powershell -ExecutionPolicy Bypass -File scripts\tests\emulator.ps1
  emulator 在中文路徑下會卡住，所以跟 dev-local.ps1 一樣從 ASCII junction 執行。
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
# 設定檔在 repo 根目錄的 firebase.test.json（rules、functions 路徑不能在設定檔所在目錄之外）
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
# 只灌菜單、配方、菜色庫與平台參數：測試自己建訂單。灌完整種子（約 3,600 筆訂單）
# 會讓 onLockCreated 等觸發器排隊好幾個小時，測試等不到自己的觸發器。
Push-Location (Join-Path $Junction "scripts")
node seed-phase1.js --catalog-only
Pop-Location
Write-Host "菜單與配方已灌入，可以跑 npm run test:functions。" -ForegroundColor Green
