<#
  本機一鍵開發環境：emulator（資料會保留）＋ 自動灌種子資料 ＋ Vite。

  用法（在 repo 根目錄或任何地方執行皆可）：
    powershell -ExecutionPolicy Bypass -File scripts\dev-local.ps1
    powershell -ExecutionPolicy Bypass -File scripts\dev-local.ps1 -Reset   # 清掉本機資料重灌

  為什麼要這支腳本：
    - emulator 資料預設只存在記憶體，每次關掉就清空 → 這裡加 --import / --export-on-exit，
      關閉 emulator 時自動存到 .emulator-data/，下次啟動自動載回。
    - emulator 在中文路徑下會卡住，必須從 ASCII junction 執行；Vite 反過來必須留在中文路徑。
      （見 TODO.md「📌 環境備忘」）
    - 資料庫是空的才灌種子（seed.js 本身也會拒絕重複灌）。
    - 種子裡「今天／明天」的訂單日期是灌入當下算的；存檔沿用幾天後日期會過期，加 -Reset 重灌即可。
#>
param(
  # 清掉 .emulator-data 後重新灌種子資料
  [switch]$Reset,
  # 指向 repo 根目錄的 ASCII junction
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

# ── 1. 在新視窗啟動 emulator（從 junction 執行；有存檔就載回，關閉時自動存檔） ──
$hasExport = Test-Path (Join-Path $dataDir "firebase-export-metadata.json")
$importArg = if ($hasExport) { "--import=.emulator-data" } else { "" }
$emuCmd = "Set-Location '$Junction'; firebase emulators:start --only functions,firestore,auth --project $ProjectId $importArg --export-on-exit=.emulator-data"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $emuCmd | Out-Null
Write-Host "emulator 啟動中（另一個視窗；關閉請在該視窗按 Ctrl+C，資料才會存檔）…" -ForegroundColor Cyan

# ── 2. 等 Firestore / Auth emulator 就緒 ──
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

# ── 3. 沒有存檔時灌種子資料 ──
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
  # 20 家商家 × 10–20 品項＋100 位會員的訂單（疊在 seed.js 之上）
  node (Join-Path $repo "scripts\seed-scale.js")
  if ($LASTEXITCODE -ne 0) {
    Write-Host "擴充種子資料沒有灌入（若訊息是 seed-user-001 already exists 代表已經有資料，可忽略）。" -ForegroundColor Yellow
  }
} else {
  Write-Host "沿用上次存檔的 emulator 資料（要重灌請加 -Reset）" -ForegroundColor Green
}

# ── 4. 確認前端會連 emulator，然後在中文路徑啟動 Vite ──
$envLocal = Join-Path $repo "web\.env.local"
if (-not ((Test-Path $envLocal) -and (Select-String -Path $envLocal -Pattern "^VITE_USE_EMULATORS=true" -Quiet))) {
  Write-Host "提醒：web\.env.local 沒有 VITE_USE_EMULATORS=true，前端會連正式站而不是 emulator。" -ForegroundColor Yellow
}
Set-Location (Join-Path $repo "web")
npx vite
