# BunnBaa — 餐飲預購鎖定平台 MVP

權威文件：`BunnBaa_0到1架構文件.docx`（唯一權威）、`BunnBaa_技術規格文件_v6_消費者端補強版.docx`。

- 正式站：https://bunnbaa-mvp-5474.web.app（Firebase 專案 `bunnbaa-mvp-5474`，Blaze 方案）
- **進度、卡點、分工一律看 [`TODO.md`](TODO.md)**；本文件只記相對穩定的架構與開發設定。
- 開工前先看 `TODO.md` 的「📌 環境備忘」（登入帳號、中文路徑下 emulator／Vite 的雷、Java）。

## 目錄結構

```
BunnBaa/
├── firebase.json / firestore.rules / firestore.indexes.json   # 專案設定
├── functions/                # Cloud Functions（Node.js，region asia-east1）
│   ├── .env.example                # 環境變數範本（Gemini、LINE Pay）
│   └── src/
│       ├── index.js                # 排程、callable、Firestore trigger 全部接線在這
│       ├── gemini.js               # Gemini API 呼叫的共用 wrapper
│       ├── vendorCalibration.js    # 商家校準 Agent（spec §4.1 / §6.1）
│       ├── consumerExplanation.js  # 消費者端折扣說明 Agent（spec §4.2 / §6.2）
│       └── linePay.js              # LINE Pay v3 簽章 + Request/Confirm API
├── scripts/
│   └── seed.js                # 種子資料（有自己的 package.json，需先 npm install）
└── web/                       # 前端（React + TypeScript + Vite + Tailwind，wouter hash 路由）
    ├── public/firebase-messaging-sw.js   # FCM 推播 service worker
    └── src/
        ├── App.tsx                    # 所有路由定義
        ├── pages/                     # 消費者端頁面（首頁、店家、品項、購物車、轉讓市集、我的鎖定…）
        │   ├── admin/                 # 平台管理後台（商家、申訴、鎖定、撥款、設定）
        │   └── vendor-portal/         # 商家後台（儀表板、菜單、訂單、備餐、掃碼核銷、報表、成長獎勵…）
        ├── components/
        │   ├── ds/                    # 自家設計系統元件（預覽頁：/#/design-system）
        │   └── ui/                    # 基礎 UI 元件（shadcn 風格）
        └── lib/
            ├── firebase.ts            # Firebase 初始化（含 emulator 切換）
            ├── messaging.ts           # FCM token 註冊（VAPID_KEY 在這裡）
            └── …                      # pricing、adminAuth、statusMap 等
```

## 資料模型（Firestore collections）

| Collection | 用途 |
|---|---|
| `vendors` | 商家 |
| `menu_items` | 商家品項 |
| `meal_plans` | 計畫型（訂閱制多日）方案 |
| `locks` | 每一筆鎖定紀錄，狀態機：`locked → for_resale / for_gift / fulfilled / no_show / resold_and_fulfilled` |
| `lock_tokens` | 鎖定對應的 FCM token（私有，只給 Functions 讀） |
| `payment_intents` | LINE Pay 付款意圖，只有 Functions 能寫 |
| `payouts` | 商家撥款結算紀錄 |
| `growth_rewards` / `draws` | 成長獎勵與抽獎紀錄 |
| `accuracy_reports` | Gemini 產出的商家校準報告 |
| `discount_explanations` | 消費者端折扣說明快取（同條件不重複呼叫 API） |
| `ban_appeals` | 帳號停權申訴 |
| `admin_audit_logs` | 管理員操作稽核紀錄 |

詳細權限見 `firestore.rules`。

## Cloud Functions 一覽

| 分類 | Function | 類型 |
|---|---|---|
| AI Agent | `dailyCalibration` | 排程（每日 23:30） |
| | `triggerCalibrationNow`、`askCalibrationScenario` | callable（手動校準、what-if 追問） |
| | `onLockCreated` | Firestore trigger（產生消費者折扣說明） |
| 金流 | `createLinePayReservation`、`createCartLinePayReservation` | callable（單品／購物車發起付款） |
| | `confirmLinePayPayment` | callable（付款確認後建立 `locks`） |
| 交易 | `claimResoldLock` | callable（接手轉讓） |
| | `markLockOutcome` | callable（商家 QR 核銷／標記 no-show） |
| 結算 | `settleVendorPayouts` | 排程（每日 20:00） |
| | `triggerSettlementNow` | callable |
| 推播 | `pickupReminders` | 排程（每 15 分鐘，取餐前 30 分鐘提醒） |
| | `triggerPickupRemindersNow` | callable |
| 成長獎勵 | `drawGrowthReward` | callable（抽獎） |

### 兩個 Gemini Agent 的設計原則

兩者都**不輸出決策指令**，輸出裡固定帶 `disclaimer` 欄位。這是刻意的設計，直接回答「AI 建議錯了誰負責」：AI 不下指令，責任不在 AI。

## 開發設定

1. 安裝 CLI：`npm install -g firebase-tools`，用專案擁有者帳號執行 `firebase login`（見 `TODO.md` 環境備忘），再執行 `firebase use bunnbaa-mvp-5474`
2. **Functions 環境變數**：
   ```bash
   cd functions
   cp .env.example .env
   # 填入 GEMINI_API_KEY（aistudio.google.com/apikey）
   # 填入 LINE_PAY_CHANNEL_ID / LINE_PAY_CHANNEL_SECRET（Sandbox channel 可自助申請）
   # LINE_PAY_ENV=sandbox，APP_BASE_URL 設成正式站或本機網址
   npm install
   ```
3. **前端**：
   ```bash
   cd web
   npm install
   ```
   推播需要在 `web/src/lib/messaging.ts` 填入 `VAPID_KEY`（Firebase Console → Cloud Messaging → Web Push 憑證）；沒填的話只會跳過註冊，不影響其他功能。
4. **種子資料腳本**：`cd scripts && npm install`
5. **本機開發**：`web/.env.local` 設 `VITE_USE_EMULATORS=false`（目前設定），本機直接讀寫雲端 Firestore，與正式站同一份資料：
   ```powershell
   npm run dev          # 只開 Vite：http://localhost:5300
   ```
   ⚠️ 本機的操作（鎖定、核銷、撥款）會直接寫進正式資料。

   **要隔離測試時改用 Emulator**：`.env.local` 改成 `VITE_USE_EMULATORS=true`，再執行
   ```powershell
   npm run dev:emulator         # 啟動 emulator、首次自動灌種子、再開 Vite；資料存在 .emulator-data/
   npm run dev:emulator:reset   # 清掉本機資料重灌（種子裡「今天／明天」的訂單過期時用）
   ```
   前提：ASCII junction 已建立（見 TODO.md「📌 環境備忘」）。
   emulator 會開在另一個視窗；**要在那個視窗按 Ctrl+C 關閉**，資料才會存檔。
   腳本內容見 `scripts/dev-local.ps1`（手動步驟：從 junction 執行 `firebase emulators:start --only functions,firestore,auth --import=.emulator-data --export-on-exit=.emulator-data`，
   再以 `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=bunnbaa-mvp-5474 node scripts/seed.js` 灌資料）。
6. **正式部署**：
   ```bash
   cd web && npm run build && cd ..
   firebase deploy --only firestore:rules,firestore:indexes,functions,hosting
   ```
   部署前確認 `web/.env.local` 沒有把 `VITE_USE_EMULATORS=true` 帶進正式建置。
