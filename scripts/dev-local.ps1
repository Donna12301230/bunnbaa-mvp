<#
  One-command local dev environment: emulator (data persists) + automatic seeding + Vite.

  Usage (run from the repo root or anywhere):
    powershell -ExecutionPolicy Bypass -File scripts\dev-local.ps1
    powershell -ExecutionPolicy Bypass -File scripts\dev-local.ps1 -Reset   # wipe local data and reseed

  Why this script exists:
    - By default emulator data lives only in memory and is lost on shutdown → this adds
      --import / --export-on-exit, so closing the emulator saves to .emulator-data/ and the next
      start loads it back.
    - The emulator hangs under a Chinese path and must run from an ASCII junction; Vite, conversely,
      must stay on the Chinese path. (See "📌 環境備忘" (environment notes) in TODO.md)
    - Seeds only when the database is empty (seed.js itself also refuses to seed twice).
    - "Today/tomorrow" order dates in the seed are computed at seed time; a saved snapshot goes
      stale after a few days, so rerun with -Reset.
#>
param(
  # Wipe .emulator-data and reseed
  [switch]$Reset,
  # ASCII junction pointing at the repo root
  [string]$Junction = "C:\Users\USER\bunnbaa-dev",
  [string]$ProjectId = "bunnbaa-mvp-5474"
)

$ErrorActionPreference = "Stop"
$repo = Split-Path $PSScriptRoot -Parent
$dataDir = Join-Path $repo ".emulator-data"

if (-not (Test-Path $Junction)) {
  Write-Host "找不到 junction $Junction，請先在 cmd 執行：" -ForegroundColor Red
  Write-Host "  mklink /J $Junction `"$repo`""
  exit 1
}
if (-not (Test-Path (Join-Path $repo "scripts\node_modules"))) {
  Write-Host "安裝種子腳本相依套件…" -ForegroundColor Cyan
  npm --prefix (Join-Path $repo "scripts") install
}

if ($Reset -and (Test-Path $dataDir)) {
  Write-Host "清除本機 emulator 資料 $dataDir" -ForegroundColor Yellow
  Remove-Item -Recurse -Force $dataDir
}

# ── 1. Start the emulator in a new window (from the junction; load the snapshot if any, save on exit) ──
$hasExport = Test-Path (Join-Path $dataDir "firebase-export-metadata.json")
$importArg = if ($hasExport) { "--import=.emulator-data" } else { "" }
$emuCmd = "Set-Location '$Junction'; firebase emulators:start --only functions,firestore,auth --project $ProjectId $importArg --export-on-exit=.emulator-data"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $emuCmd | Out-Null
Write-Host "emulator 啟動中（另一個視窗；關閉請在該視窗按 Ctrl+C，資料才會存檔）…" -ForegroundColor Cyan

# ── 2. Wait for the Firestore / Auth emulators to be ready ──
function Wait-Port([int]$port, [int]$timeoutSec = 120) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $client = New-Object System.Net.Sockets.TcpClient
      $client.Connect("127.0.0.1", $port)
      $client.Close()
      return $true
    } catch { Start-Sleep -Seconds 2 }
  }
  return $false
}
foreach ($port in 8080, 9099) {
  if (-not (Wait-Port $port)) {
    Write-Host "emulator 在 port $port 逾時沒有回應，請看 emulator 視窗的錯誤訊息。" -ForegroundColor Red
    exit 1
  }
}
Write-Host "emulator 已就緒（UI：http://localhost:4000）" -ForegroundColor Green

# ── 3. Seed data when there is no snapshot ──
if (-not $hasExport) {
  Write-Host "灌種子資料到 emulator…" -ForegroundColor Cyan
  $env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
  $env:FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099"
  $env:GCLOUD_PROJECT = $ProjectId
  $env:GOOGLE_APPLICATION_CREDENTIALS = ""
  node (Join-Path $repo "scripts\seed.js")
  if ($LASTEXITCODE -ne 0) {
    Write-Host "種子資料沒有灌入（若訊息是 locks already exist 代表已經有資料，可忽略）。" -ForegroundColor Yellow
  }
  # 20 vendors × 10–20 items + orders from 100 members (on top of seed.js)
  node (Join-Path $repo "scripts\seed-scale.js")
  if ($LASTEXITCODE -ne 0) {
    Write-Host "擴充種子資料沒有灌入（若訊息是 seed-user-001 already exists 代表已經有資料，可忽略）。" -ForegroundColor Yellow
  }
  # Phase 1 spec: templates, recipes, bentos, order history, wishes, reward pool (fixed ids, safe to rerun)
  node (Join-Path $repo "scripts\seed-phase1.js")
  if ($LASTEXITCODE -ne 0) {
    Write-Host "第一階段種子資料沒有灌入，請看上面的錯誤訊息。" -ForegroundColor Yellow
  }
} else {
  Write-Host "沿用上次存檔的 emulator 資料（要重灌請加 -Reset）" -ForegroundColor Green
}

# ── 4. Check the frontend points at the emulator, then start Vite on the Chinese path ──
$envLocal = Join-Path $repo "web\.env.local"
if (-not ((Test-Path $envLocal) -and (Select-String -Path $envLocal -Pattern "^VITE_USE_EMULATORS=true" -Quiet))) {
  Write-Host "提醒：web\.env.local 沒有 VITE_USE_EMULATORS=true，前端會連正式站而不是 emulator。" -ForegroundColor Yellow
}
Set-Location (Join-Path $repo "web")
npx vite
