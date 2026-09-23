# BunnBaa — 第一階段原型（餐飲預購鎖定機制）

對應 `BunnBaa_技術規格文件_v6_消費者端補強版.docx`。這是骨架實作，不是成品——
已經把資料模型、Cloud Functions、前端頁面的架構搭好，接下來是照時程表把每一塊填滿、跑通、部署。

## 目錄結構

```
bunnbaa/
├── firebase.json / firestore.rules / firestore.indexes.json   # 專案設定
├── functions/                # Cloud Functions（Node.js）
│   └── src/
│       ├── gemini.js               # Gemini API 呼叫的共用 wrapper
│       ├── vendorCalibration.js    # 商家端校準 Agent（spec §4.1 / §6.1）
│       ├── consumerExplanation.js  # 消費者端折扣說明 Agent（spec §4.2 / §6.2）
│       └── index.js                # 排程、callable、Firestore trigger 全部接線在這
├── scripts/
│   └── seed.js                # 產生情境模擬的商家與 14 天歷史鎖定資料
└── web/                       # 前端（React + TypeScript + Vite）
    └── src/
        ├── pages/ConsumerLockPage.tsx   # 消費者鎖定頁
        ├── pages/VendorDashboard.tsx    # 商家校準報告後台
        └── lib/firebase.ts              # Firebase 初始化（需填入你的專案設定）
```

## 資料模型（對應 spec §5.3）

- `vendors` — 商家（demo 用 `cafe-renheya-demo` 一筆，對應仁和雅咖啡）
- `locks` — 每一筆鎖定紀錄，狀態機：`locked → for_resale / fulfilled / no_show / resold_and_fulfilled`
- `accuracy_reports` — Gemini 產出的校準報告
- `discount_explanations` — 消費者端折扣說明的快取（同條件不重複呼叫 API）

## 兩個 Gemini Agent，職責切分（對應 spec 第四節）

| Agent | 觸發時機 | 輸出 |
|---|---|---|
| 商家校準（`vendorCalibration.js`） | 每日排程 `dailyCalibration`，或手動呼叫 `triggerCalibrationNow` | 準確率、誤差區間、落差模式、what-if 追問回覆 |
| 消費者折扣說明（`consumerExplanation.js`） | 新建 `locks` 文件時（`onLockCreated` trigger），生成後快取 | 1-2 句白話說明 |

兩者都**不輸出決策指令**，輸出裡固定帶 `disclaimer` 欄位——這是刻意的設計，直接對應「AI 建議錯了誰負責」這個問題的答案：AI 不下指令，責任不在 AI。

## 開發步驟

1. **建立 Firebase 專案**（[console.firebase.google.com](https://console.firebase.google.com)），啟用 Firestore、Functions、Hosting、Authentication（匿名登入）
2. 安裝 CLI：`npm install -g firebase-tools`，然後 `firebase login`
3. 在專案根目錄：`firebase use --add`，選擇你的專案，把 `.firebaserc` 產生出來
4. **取得 Gemini API Key**：[aistudio.google.com/apikey](https://aistudio.google.com/apikey)
   ```bash
   cd functions
   cp .env.example .env
   # 編輯 .env，填入 GEMINI_API_KEY
   npm install
   ```
5. **前端設定**：把 `web/src/lib/firebase.ts` 裡的 `firebaseConfig` 換成你專案的設定值（Firebase Console → 專案設定 → 一般 → 你的應用程式）
   ```bash
   cd ../web
   npm install
   ```
6. **本機測試（用 Emulator，不用真的部署也能跑）**：
   ```bash
   # 專案根目錄
   firebase emulators:start --only functions,firestore,auth
   ```
   另開一個終端機：
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS= FIRESTORE_EMULATOR_HOST=localhost:8080 \
     node scripts/seed.js
   ```
   再開一個終端機跑前端（記得在 `web/.env.local` 加一行 `VITE_USE_EMULATORS=true`）：
   ```bash
   cd web && npm run dev
   ```
7. **正式部署**（Demo 影片錄製前）：
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes,functions,hosting
   ```

## 跟開發時程表的對應（spec §7）

- 第 1 週：完成上面步驟 1-4，確認 Gemini API 基礎串接成功（可以先寫一個最簡單的 script 直接呼叫 `generateJSON` 測試）
- 第 2 週：把 `ConsumerLockPage` 和轉賣流程做完整（目前轉賣的 UI 還沒做，只有資料模型和 Firestore rules 預留了 `for_resale` 狀態）
- 第 3 週：`seed.js` 跑出情境資料、`dailyCalibration` 和 `onLockCreated` 兩個 Agent 調校到位
- 第 4 週：`VendorDashboard` 打磨、整合測試、部署到正式環境
- 第 5 週：錄 Demo、寫英文版 Proposal

## 尚未實作，留給你或工程師接手的部分

- 轉賣（`for_resale` → `resold_and_fulfilled`）的實際 UI 流程，目前只有 Firestore rules 預留欄位
- 商家履約穩定度徽章（spec §3.5）目前用 `vendor.reliability_tone` 這個手動欄位示意，實際上應該由 `accuracy_rate` 自動換算等級（例如 >80% = 穩定），可以在 `dailyCalibration` 裡順手更新這個欄位
- [V] 取餐時段推播提醒（spec §3.7，Firebase Cloud Messaging）——這塊跟 AI 無關，純 UX。程式碼已寫好：消費者鎖定時前端要求通知權限、取 FCM token 存進私有的 `lock_tokens` 文件（`web/src/lib/messaging.ts` + `web/public/firebase-messaging-sw.js`），Functions 端新增 `pickupReminders`（每 15 分鐘掃一次，取餐前 30 分鐘內發送）+ `triggerPickupRemindersNow` 手動觸發。**還沒端到端測過**：一是要去 Firebase Console → Cloud Messaging 拿 Web Push 憑證（VAPID key）填進 `messaging.ts`（免費、跟 Blaze 無關，純 Console 點一下），二是 `pickupReminders`／`triggerPickupRemindersNow` 這兩個 Function 一樣卡在 Blaze 升級沒部署。
- 商家後台標記 no-show／備註的介面（目前 `seed.js` 是直接寫死模擬資料，實際要讓商家自己在後台標記）
