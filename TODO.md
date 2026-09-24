# BunnBaa 開發 TODO

對應文件：`BunnBaa_0到1架構文件.docx`（唯一權威文件）、`BunnBaa_技術規格文件_v6_消費者端補強版.docx`（兩份都在 repo 根目錄）、`BunnBaa_現有雛型改造指南.docx`（目前在本機找不到）。舊雛型參照：`../BunnBaa Parse_Ref/`。架構與開發設定見 [README.md](README.md)。

**截止日：10/18 前提交 Demo ＋ 英文版 Proposal。**

狀態圖例：✅ 已完成／🟡 程式碼完成但未在正式站驗證／🔴 卡住（等人工或外部審核）／⬜ 未開始

---

## 🔴 待辦總表（依優先順序）

### 1. 外部卡點（人工處理，歸 Donna）

- [V] **Gemini API Key**——2026-09-24 完成，本機實測兩個 Agent 都能產出。注意：`bunnbaa-mvp-5474` 因為 Blaze 綁了帳單，會自動變成付費層（Prepay，餘額 $0 → 402），所以 key 是從**另一個沒綁帳單的新專案**申請，走免費層。同時把已下架的 `gemini-2.0-flash` 換成 `gemini-3.6-flash`，並對 503／429 加上重試（`functions/src/gemini.js`）。**還要重新部署 functions 才會在正式站生效**（見 §2）
- [-] **LINE Pay／綠界特約商店審核**（2026-09-24 決定：Demo 沿用 Sandbox，暫不送審）——Sandbox 已全部跑通。之後要正式上線再送審（可能要數週），審核過後把 `functions/.env` 換成正式 Channel ID/Secret＋`LINE_PAY_ENV=production` 即可，程式碼不用改
- [V] **VAPID key**——2026-09-24 已填入，待部署 hosting 後在正式站驗證。（`web/src/lib/messaging.ts` 的 `VAPID_KEY`）

### 2. 部署（2026-09-23 晚上的變更還沒上正式站）

`firestore.rules` 新增 `menu_items`／`meal_plans`／`ban_appeals` 規則，`functions/src/index.js` 改了 `createCartLinePayReservation`／`createLinePayReservation`（改吃每個品項的真實 `vendor_id`）：
- [ ] `firebase deploy --only firestore:rules`
- [ ] `firebase deploy --only functions`
- [ ] `cd web && npm run build` 後 `firebase deploy --only hosting`（設計系統／新 design tokens 也還沒上線）
- [ ] 部署後實測一次購物車結帳，到 Firestore Console 確認新的 `locks.vendor_id` 對應下單的商家，不是全部掛在 `cafe-renheya-demo`

### 3. 正式站驗證（已部署，但還沒在正式站實際跑過）

- [ ] QR Code 核銷：`markLockOutcome`／`VendorRedeemPage.tsx`（emulator 已驗證）
- [ ] 撥款排程：`settleVendorPayouts`＋手動觸發（emulator 已驗證重複點擊不會重複結算）
- [ ] 成長獎勵抽獎：`drawGrowthReward`
- [ ] 我的鎖定頁：`MyLocksPage.tsx`（`/my-locks`）
- [ ] 取餐提醒推播：`pickupReminders`／`triggerPickupRemindersNow`
- [ ] 商家校準報告＋what-if 追問：`dailyCalibration`／`askCalibrationScenario`，以及 `reliability_tone` 自動換算
- [ ] 到 Firestore Console 確認 `admin_audit_logs` 有 2026-09-21 煙霧測試產生的兩筆（含 `admin_email` 與狀態變化）

### 4. Demo 準備（整合與交付）

- [ ] 正式站灌 demo 資料（`scripts/seed.js`，正式環境 Firestore 目前是空的）
- [ ] 照 ISO27001 文件的「商家帳號綁定」流程建商家帳號並設定 `vendors/{id}.owner_uid`，否則商家儀表板看不到資料
- [ ] 整合測試（端到端跑過消費者、商家、管理員三條線）
- [ ] 錄 Demo（3 分鐘腳本見 v6 §8）
- [ ] 撰寫英文版 Proposal

### 5. ISO27001 剩餘項目（詳見 [ISO27001_落差分析.md](ISO27001_落差分析.md)）

- [ ] 長期觀察沒有 CSP 違規後，把 `firebase.json` 的 `Content-Security-Policy-Report-Only` 改成 `Content-Security-Policy`（目前只測過 `/lock` 跟兩個管理頁）
- [ ] Console 手動項目：帳號 2FA；Firebase API key 加 referrer 限制（`bunnbaa-mvp-5474.web.app/*`、`bunnbaa-mvp-5474.firebaseapp.com/*`、`localhost:*`，存檔後立刻重測正式站）；Cloud Audit Logs 開資料讀寫；GitHub `master` branch protection（要先跟雅婷討論改走 PR）
- [ ] 建立認證所需的 ISMS 管理制度文件

### 6. 尚未實作的功能

- [ ] **手機門號 OTP 登入**（`LoginPage.tsx`，草圖 `Login.dc.html` 已確認兩段式流程）——目前是 `mockAuth.ts` 用帳號字串猜角色，消費者端則是匿名 Firebase Auth。接上後 `role` 改從 Firestore `users/{uid}` 讀
- [ ] **消費者端提交解封申訴**——完全沒有入口（登入頁條款的「會員中心提交申訴」只是文字）。要先有 OTP 登入：匿名 uid 換裝置就變，沒有穩定身分能綁定封禁狀態
- [ ] 「我的轉讓」無法追蹤已被接手的項目（資料模型沒有記錄原轉讓者）

### 7. 待決策

- **揪團預購場次／現場點餐**（商家後台的訂餐時段／核對取餐／訂單管理／統計報表等頁目前仍是 mock）：消費者端從來沒有「加入場次／下團購單」的入口。選項：
  - (a) 維持現狀，當示意頁
  - (b) 只把商家後台那半邊（`order_sessions`／`pre_orders`／`table_orders`）接真 Firestore，消費者端仍沒入口
  - (c) 連消費者端畫面一起從零設計開發，規模最大
- **商家訂閱平台**：`mockData.ts` 只剩這條線在用（`VendorPortalSettings.tsx`／`VendorPortalLayout.tsx`／`admin/AdminVendorsPage.tsx`），真實後端沒有「商家訂閱」這個概念，還沒排進範圍

---

## 📌 環境備忘（新機器／新 session 開工前先看）

- **帳號**：GCP/Firebase 專案掛在 `ckchildlikekid@gmail.com`（鍾雅婷），**不是** `tom040798@gmail.com`。CLI 登入、瀏覽器操作都要用前者，否則 `firebase projects:list` 會顯示空的。
- **路徑雷**（專案路徑含中文字和 `+` 號，Windows 上兩個工具的行為相反）：
  - Firebase emulator 在中文路徑下會卡在 discovery timeout → 要從 ASCII junction `C:\Users\USER\bunnbaa-dev` 執行（2026-09-24 已確認指向 repo 根目錄）。若日後 repo 搬家要重建：`rmdir C:\Users\USER\bunnbaa-dev` 後執行 `mklink /J C:\Users\USER\bunnbaa-dev "D:\雅婷\03赫滋與羊\+程式碼\BunnBaa"`（在 cmd 裡跑）
  - Vite dev server 從 junction 路徑執行會出現空白頁 → **要留在原本的中文路徑** `D:\雅婷\03赫滋與羊\+程式碼\BunnBaa\web`
- **Java**：Firestore/Auth emulator 需要 JRE，已用 winget 裝 Microsoft OpenJDK 21 並加進 PATH。
- **`web/.env.local` 的 `VITE_USE_EMULATORS=true`**：會讓前端連本機 emulator。已排除在 `.gitignore`，2026-09-24 已在 `firebase.ts` 加上 `import.meta.env.DEV` 判斷，正式建置不會誤連 emulator。
- **設計系統預覽**：本機 http://localhost:5199/#/design-system
- **網域**：`bunnbaa.com` 掛在舊專案（Parse 版本），MVP 先不動，暫用 https://bunnbaa-mvp-5474.web.app ，之後要換網域再處理 DNS。
- **GitHub**：獨立的 private repo，不跟舊專案共用：https://github.com/Donna12301230/bunnbaa-mvp

---

## 模組總覽（2026-09-18 確認分工）

### Donna 負責

| 模組 | 狀態 | 備註 |
|---|---|---|
| Firebase 專案建置 | ✅ | Blaze 已啟用，Firestore／Auth／Functions／Hosting／規則都已上線 |
| Firebase Hosting 部署 | ✅ | 2026-09-23 重新部署；之後的變更見待辦 §2 |
| 鎖定＋付款流程 | ✅ | LINE Pay Sandbox 端到端測試通過 |
| 金流串接（消費端） | 🔴 | Sandbox 完成；Demo 沿用 Sandbox，正式上線才需特約商店審核 |
| 轉賣流程（含取消轉讓） | ✅ | `claimResoldLock`，兩個匿名帳號互相接手已測 |
| 轉賣金流（買家對買家） | ✅ | 設計上不經過平台，只轉移 `buyer_uid` |
| QR Code 核銷 | 🟡 | 見待辦 §3 |
| 撥款排程 | 🟡 | 見待辦 §3 |
| 取餐提醒推播（FCM，同 SU「通知系統」） | 🟡 | 程式碼由 SU 完成，VAPID key 已填，待部署驗證 |
| 我的鎖定／訂單記錄頁 | 🟡 | `MyLocksPage.tsx`，簡易列表（週曆版在 `MyBookingsPage.tsx`） |
| Gemini — 商家校準 Agent | 🟡 | Key 已到位、本機測通，待部署後在正式站驗證 |
| Gemini — 消費者折扣說明 Agent | 🟡 | 同上 |
| UI 模型建置 | ⬜ | UI 規格書過時，見待辦 §6 |
| 整合測試 | ⬜ | 見待辦 §4 |
| Demo 錄製＋Proposal | ⬜ | **10/18 前提交** |

### SU 負責

| 模組 | 狀態 | 備註 |
|---|---|---|
| 商家清單／商家頁 | ✅ | `VendorListPage.tsx`／`VendorPage.tsx`，已改讀真實 `vendors` |
| 商品列表／詳情頁 | ✅ | `VendorPage.tsx`／`MenuItemPage.tsx`，已改讀真實 `menu_items` |
| 管理員後台 | ✅ | 訂單總覽／撥款總覽／系統設定／解封申訴都接真 Firestore，外加 `RequireRealAdmin` 驗證真實帳號；廠商管理仍是 mock |
| 權限控管／Firestore 安全規則 | ✅ | `firestore.rules`，新規則待部署（待辦 §2） |
| 商家後台儀表板 | 🟡 | 含撥款區塊＋手動觸發按鈕；需要綁定 `owner_uid` |
| 商家校準報告呈現（含 what-if 追問） | 🟡 | Gemini Key 已到位，待部署後在正式站驗證 |
| 通知系統（FCM） | 🟡 | 同 Donna「取餐提醒推播」 |
| 會員／身分驗證（手機門號 OTP） | ⬜ | 目前是匿名登入＋mock 登入，見待辦 §6 |
| ISO27001 | 🟡 | 技術面已修補並部署，剩餘項目見待辦 §5 |

---

## UI 草圖對照

UI 草圖：https://claude.ai/artifact/WyPDxzfSrUG2ZA4M3EDrJc （只參考版面骨架與資訊架構，配色和字體不採用）。三頁（Main/Marketplace/MyBookings）共用 3 項主導覽「預購鎖定／轉讓市集／我的商品」；`PlanSchedule.dc.html` 已合併進 `Main.dc.html`。

| 草圖頁 | 現有對應 | 狀態 |
|---|---|---|
| `PlanSchedule.dc.html`（合作店家與計畫） | `HomePage.tsx` | ✅ 讀真實 `vendors`／`meal_plans` |
| `Main.dc.html`「預購鎖定」 | `HomePage.tsx` | ✅ 「今日推薦鎖定方案」呼叫 `createLinePayReservation`，套用早鳥折扣 |
| `Marketplace.dc.html`「轉讓市集」 | `TransferMarketPage.tsx`（`/marketplace`） | ✅ 瀏覽／接手／免費領取／我的轉讓／取消轉讓都接真 Firestore |
| `MyBookings.dc.html`「我的商品」 | `MyBookingsPage.tsx`（`/my-bookings`） | ✅ 資料驅動的週曆；使用（QR）／贈送／交易／回饋都接真 Firestore |
| `Login.dc.html`（手機門號 OTP） | `LoginPage.tsx` | ⬜ 見待辦 §6 |
| `VendorDashboard.dc.html`（商家後台） | `VendorPortalLayout.tsx` 系列 | 🟡 備料、成長獎勵、菜單接真資料；揪團場次類頁面仍是 mock（待辦 §7） |

---

## 測試帳號

`/login` 目前是 `mockAuth.ts` 的假登入：不驗證密碼，只依帳號字串判斷角色（含 `admin` → 管理員、含 `vendor` → 廠商、其餘 → 一般會員）。登入後一律先進 `/home`，右上角下拉選單依角色顯示後台入口。

| 角色 | 帳號 | 密碼 | 後台入口 |
|---|---|---|---|
| 一般會員 | customer@test.com | 任意 | 會員中心 `/profile` |
| 廠商 | vendor@test.com | 任意 | 廠商後台 `/vendor-portal/dashboard` |
| 管理員 | admin@test.com | 任意 | 管理後台 `/admin/vendors` |

要寫入真實資料的管理頁，另外由 `RequireRealAdmin` 要求真實 Firebase Auth 管理員帳號登入（例：`suw192336@gmail.com`）。

---

## 設計決策與技術筆記（已完成的背景紀錄）

**資料模型統一（2026-09-23，選項 b）**：原本「商品瀏覽」這條線（從 `BunnBaa Parse_Ref` 搬來的 `VendorData`／`MenuItemData`）跟真正在跑的 `Lock`／`Vendor` 流程是兩套互不相干的資料模型。最後決定整套併進真正的 `Vendor` 模型：`VendorListPage`／`VendorPage`／`MenuItemPage`／`CartPage`／`VendorPortalMenu` 改讀寫真實 `vendors`＋`menu_items`（規則重用 `isVendorOwner()`），兩個 LINE Pay reservation function 拿掉寫死的 `CART_VENDOR_ID`，改吃每個品項的 `vendor_id` 並驗證商家存在。

**LINE Pay Sandbox 串接（2026-09-23）**：`functions/src/linePay.js`（v3 簽章＋Request/Confirm API），流程是 Request → 導向 LINE Pay → `confirmLinePayPayment` 確認後才建立 `locks`。`confirmLinePayPayment` 統一處理 `lock_drafts` 陣列，單品項（`/lock`）跟購物車多品項（每個品項×數量展開成 N 筆 `locks`）共用。端到端測試中修掉兩個 bug：
1. **hash 路由 404**：LINE Pay 導回時直接把 `?transactionId=...` 串在 `confirmUrl` 後面，不理會 `#`。改成把 `orderId` 放進路徑（`/payment/confirm/:orderId`），並做防禦性截斷。
2. **Confirm API 回「1159 交易不存在」**：`transactionId` 是 19 位數，超過 JS `Number` 的安全整數範圍，`res.json()` 會失去精度。改成解析前先把數字字面值加上引號再 `JSON.parse`，以字串保留。

**計畫型（訂閱制多日方案）**：沒有另外的 subscription collection，「預約加入計畫」當下直接寫入 N 筆 `locks`（用 `plan_id`／`plan_label` 串起來），取餐日從明天起連續 N 天，不需要排程 Function。

**成長獎勵抽獎**：`drawGrowthReward` 在伺服器端計算，採機率權重制，0 元券見底時自動降級成 1 折保底（機率不能信任 client）。

**早鳥階梯定價**：95／8／7 折，純函式 `web/src/lib/pricing.ts`，依 `pickupDate` 計算。

**轉讓逾時自動開放 $0 元領取**：沿用 `firestore.rules` 的 lazy expiry 規則，不需要排程 Function。

**贈送**：`for_gift` 機制沒有「指名」欄位，生成連結後私下傳給朋友，跟 QR 取餐碼「給誰就是誰的」是同一套信任模型。

**認證商家徽章**：`Vendor.verified`（只有 admin 能寫），在 `AdminSettingsPage.tsx` 勾選。

**備料聚合**：`VendorPortalPrep.tsx` 用 `onSnapshot` 依 `pickup_date`＋`pickup_window` 即時分組。

**ISO27001 技術修補（2026-09-21 已部署）**：Functions 授權（管理員／商家 owner）、`payouts`／`accuracy_reports` 只限管理員和該商家 owner 讀取、FCM token 私有化（`lock_tokens`）、`locks` 完整性規則、管理員稽核日誌、Hosting 安全標頭。煙霧測試已通過：`/lock` 鎖定、管理員狀態切換、CSP 無違規。

**Blaze 升級（2026-09-23）**：過程中卡過一次信用卡「交易遭拒」；第一次部署 `onLockCreated` 時卡在 Eventarc 權限生效，等待後重試成功。
