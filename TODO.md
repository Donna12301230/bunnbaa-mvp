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

### 2. 部署（2026-09-25 已全部部署：規則＋索引、Functions、hosting）

`firestore.rules` 新增 `menu_items`／`meal_plans`／`ban_appeals` 規則，`functions/src/index.js` 改了 `createCartLinePayReservation`／`createLinePayReservation`（改吃每個品項的真實 `vendor_id`）：
- [x] `firebase deploy --only firestore:rules,firestore:indexes`（2026-09-24 再次更新：`locks` 改成只有轉賣中／贈送中公開讀，新增 `vendor_id+status+created_at` 複合索引——**索引要先建好**，不然轉讓市集查詢會失敗；2026-09-24 又新增 `users`／`vendor_applications` 規則，平台登入改真實 Firebase Auth 後註冊、廠商申請都要靠這兩條）
- [x] `firebase deploy --only functions`（2026-09-24 起消費端 callable 會擋匿名身分，前端已不再匿名登入，**規則、Functions、hosting 要一起部署**，不然舊版前端的匿名使用者會全部被擋）
- [x] `cd web && npm run build` 後 `firebase deploy --only hosting`（設計系統／新 design tokens 也還沒上線）
- [ ] **Functions runtime 升級**：部署時警告 Node.js 20 於 **2026-10-30 停用**，之後無法再部署 Functions。10/18 Demo 不受影響，比賽後要繼續改 Functions 前，先把 `functions/package.json` 的 engines 升到 Node 22＋`firebase-functions@latest`（有 breaking changes，要重測）
- [ ] 部署後實測一次購物車結帳，到 Firestore Console 確認新的 `locks.vendor_id` 對應下單的商家，不是全部掛在 `cafe-renheya-demo`

### 3. 正式站驗證（已部署，但還沒在正式站實際跑過）

- [ ] QR Code 核銷：`markLockOutcome`／`VendorRedeemPage.tsx`（emulator 已驗證，但 **emulator 下 `assertAdminOrVendorOwner` 直接放行，權限這段只有正式站測得到**）。前置：§2 部署完＋§4 商家帳號綁定。步驟：
  1. 一般會員帳號鎖定一筆仁和雅咖啡的餐（LINE Pay Sandbox 付款）→ `/my-bookings`「使用」記下取餐編號末 8 碼
  2. 商家帳號登入 `/lock/vendor/redeem`：取餐總覽要看得到這筆（驗證 `locks` 讀取規則＋`vendor_id+created_at` 索引），輸入末 8 碼查得到
  3. 按「確認取餐」→ Firestore Console 看 `locks/{id}.status` 變 `fulfilled`
  4. 再鎖一筆，改按「登記未取餐」填備註 → `status=no_show`＋`no_show_note`
  5. 負面測試：已核銷的同一碼再查一次要被擋；用**別家**商家帳號或一般會員呼叫要回 `permission-denied`
  - 註：目前商家端**沒有相機掃碼**，是店員看 QR 下方的取餐編號手動輸入（QR 內容是 `{lockId, vendorId}` JSON，但沒有頁面去解它）。Demo 若要真的「掃 QR」得另外接掃碼套件
  - 2026-09-25：`markLockOutcome` 補上伺服器端狀態檢查（只有 `locked`／`for_resale` 可核銷，用 transaction 防兩台裝置重複核銷），原本直接呼叫可以把已完成／已結算的鎖定改成 `no_show`。要跟 §2 的 functions 一起部署
- [ ] 撥款排程：`settleVendorPayouts`＋手動觸發（emulator 已驗證重複點擊不會重複結算）
- [ ] 成長獎勵抽獎：`drawGrowthReward`（2026-09-24 修：消費者首頁原本讀 `payouts` 判斷是否解鎖，但 `payouts` 只限管理員／店主讀，消費者永遠看不到抽獎。改成讀公開的 `growth_rewards.unlocked_milestones`，由撥款結算的 `syncGrowthUnlock` 寫入、只有門檻 id 不含金額。**部署 Functions 後要跑一次** `triggerSettlementNow`（或等當天 20:00 排程）把正式站的解鎖狀態補上，不然首頁還是顯示未解鎖）
- [ ] 我的鎖定頁：`MyLocksPage.tsx`（`/my-locks`）
- [ ] 取餐提醒推播：`pickupReminders`／`triggerPickupRemindersNow`
- [ ] 商家校準報告＋what-if 追問：`dailyCalibration`／`askCalibrationScenario`，以及 `reliability_tone` 自動換算
- [ ] 到 Firestore Console 確認 `admin_audit_logs` 有 2026-09-21 煙霧測試產生的兩筆（含 `admin_email` 與狀態變化）

### 4. Demo 準備（整合與交付）

- [x] 正式站灌 demo 資料（`scripts/seed.js`）——2026-09-24 確認雲端已有資料（seed.js 回報 locks already exist），不需再灌
- [ ] **正式站商家帳號綁定**（2026-09-24 起平台登入是真實 Firebase Auth，沒綁 `owner_uid` 的帳號進不了廠商後台）：規則部署後，商家到 `/login`「廠商申請」送出 → 管理員登入 `/admin/vendors` 核准並選「綁定到既有商家：仁和雅咖啡」等（會寫 `admin_audit_logs`）。正式站目前**沒有任何**商家帳號，種子資料的 `owner_uid` 全是 `null`
- [ ] 整合測試（端到端跑過消費者、商家、管理員三條線）
- [ ] 錄 Demo（3 分鐘腳本見 v6 §8）
- [ ] 撰寫英文版 Proposal

### 5. ISO27001 剩餘項目（詳見 [ISO27001_落差分析.md](ISO27001_落差分析.md)）

- [ ] 長期觀察沒有 CSP 違規後，把 `firebase.json` 的 `Content-Security-Policy-Report-Only` 改成 `Content-Security-Policy`（目前只測過 `/lock` 跟兩個管理頁）
- [x] SU 自己的 Google／GitHub 帳號 2FA——2026-09-25 完成（理由見 ISO27001 文件「情境重新評估」：這是參賽用原型不是正式上線，但比賽規則要求公開 repo＋公開網址，評審期間客觀上是曝露的，值得做）
- [x] Firebase API key 加 referrer 限制——2026-09-25 完成並驗證：已加三筆（`bunnbaa-mvp-5474.web.app/*`、`bunnbaa-mvp-5474.firebaseapp.com/*`、`localhost:*`）。用 `curl` 帶假 Referer 直接打 Firebase Auth 初始化 API 測過：正確網域回 200，不相干網域（`evil.example.com`）與完全不帶 Referer 都回 403 `API_KEY_HTTP_REFERRER_BLOCKED`，正式站本身仍正常載入（HTTP 200）
- [-] ~~Cloud Audit Logs 開資料讀寫~~——2026-09-25 決定暫緩：只有事後鑑識用途（查誰讀寫過什麼），不會擋下任何事，對三週衝刺的參賽專案報酬率低，等要往正式商轉再開
- [ ] **待跟雅婷討論，不預設要做**：`ckchildlikekid@gmail.com` 開 2FA；GitHub `master` branch protection（會改變目前直接推 master 自動部署的流程，衝刺截止日前可能得不償失，見 ISO27001 文件）
- [x] 建立認證所需的 ISMS 管理制度文件——2026-09-25 完成 v1：[ISMS_管理制度文件.md](ISMS_管理制度文件.md)（資安政策、角色職責、風險評鑑與登錄表、適用性聲明 SoA、事件應變程序、備份與 BCP 現況、供應商清單、人員安全、文件審查）。這是符合兩人團隊試營運規模的精簡版，不是拿去給認證機構稽核用的完整版；風險登錄表列了 9 項風險，其中 R1/R4/R5/R7 對應到還沒做的待辦（2FA、branch protection、Firestore 備份、Secret Manager）

### 6. 尚未實作的功能

- [x] **手機門號 OTP 登入**（`LoginPage.tsx`，草圖 `Login.dc.html` 兩段式流程）——2026-09-25 完成：登入分頁新增「改用手機門號登入」，輸入號碼→`sendOtp()`送簡訊驗證碼→輸入驗證碼→`confirmOtp()`登入（`web/src/lib/auth.ts`，用 Firebase Phone Auth + 隱形 reCAPTCHA）。沒有 email 時 `resolveProfile()` 改用門號當 username／displayName，角色判斷不受影響（管理員＝email 白名單，門號登入者一律是會員或已綁定的廠商）。順便修正 CSP：加放 `www.google.com`／`recaptcha.net` 的 script／frame，不然 reCAPTCHA 之後會被擋（`firebase.json`）。**還沒驗證**：要先去 Firebase Console → Authentication → Sign-in method 手動啟用「電話號碼」登入方式（跟啟用 Email/Password 一樣，免費、跟 Blaze 無關），且要等這批一起部署（見上方 §2）後才能在正式站測；本機/emulator 也還沒測過，因為 Phone Auth 的 reCAPTCHA 在沒有真實網域時常會失敗，建議直接在正式站用真手機號碼測
- [x] 2026-09-24 決定**不再使用匿名登入**：瀏覽不用登入，但鎖定／下單／購物車結帳／轉讓接手／抽獎都要先登入（前端 `useRequireLogin`、`firestore.rules` `isSignedInUser()`、Functions `assertSignedInUser()` 三層都擋）。舊的匿名帳號跟它們名下的鎖定紀錄**不搬移、不保留**
- [ ] 部署規則＋Functions 後，到 Firebase Console → Authentication → Sign-in method 把「匿名」停用
- [ ] **消費者端提交解封申訴**——完全沒有入口（登入頁條款的「會員中心提交申訴」只是文字）。現在消費者已有穩定帳號，可以開始做了
- [ ] 「我的轉讓」無法追蹤已被接手的項目（資料模型沒有記錄原轉讓者）

### 7. 待決策

- **揪團預購場次／現場點餐**（商家後台的訂餐時段／核對取餐／訂單管理／統計報表等頁目前仍是 mock）：消費者端從來沒有「加入場次／下團購單」的入口。選項：
  - (a) 維持現狀，當示意頁
  - (b) 只把商家後台那半邊（`order_sessions`／`pre_orders`／`table_orders`）接真 Firestore，消費者端仍沒入口
  - (c) 連消費者端畫面一起從零設計開發，規模最大
- ~~**商家訂閱平台**~~ 2026-09-24 已接真 Firestore（`web/src/lib/subscription.ts`）：狀態存在 `vendors/{id}.subscription_*`，到期（`subscription_end_date` 已過）整個廠商後台擋住；商家只能自助「申請取消」「到期前撤回」（`firestore.rules` 限定這兩種轉換）；**沒有訂閱金流**，續約由管理員確認收款後在 `/admin/vendors` 按「續約 30 天」（寫 `admin_audit_logs`）。新核准的商家自動首月免費試用。正式站既有商家沒有訂閱欄位＝「尚未設定」，不擋也不能自助操作，要管理員按一次續約才開始計期。之後要自動扣款再接 LINE Pay 定期付款

---

## 📌 環境備忘（新機器／新 session 開工前先看）

- **帳號**：GCP/Firebase 專案掛在 `ckchildlikekid@gmail.com`（鍾雅婷），**不是** `tom040798@gmail.com`。CLI 登入、瀏覽器操作都要用前者，否則 `firebase projects:list` 會顯示空的。
- **路徑雷**（專案路徑含中文字和 `+` 號，Windows 上兩個工具的行為相反）：
  - Firebase emulator 在中文路徑下會卡在 discovery timeout → 要從 ASCII junction `C:\Users\USER\bunnbaa-dev` 執行（2026-09-24 已確認指向 repo 根目錄）。若日後 repo 搬家要重建：`rmdir C:\Users\USER\bunnbaa-dev` 後執行 `mklink /J C:\Users\USER\bunnbaa-dev "D:\雅婷\03赫滋與羊\+程式碼\BunnBaa"`（在 cmd 裡跑）
  - Vite dev server 從 junction 路徑執行會出現空白頁 → **要留在原本的中文路徑** `D:\雅婷\03赫滋與羊\+程式碼\BunnBaa\web`
- **Functions 部署逾時**：`firebase deploy --only functions` 偶爾在 Windows 上報 `User code failed to load ... Timeout after 10000`（程式碼本身沒問題，是 CLI 分析階段超過 10 秒）。改用 `FUNCTIONS_DISCOVERY_TIMEOUT=60 npx firebase deploy --only functions`（Git Bash 語法）重跑即可。
- **Java**：Firestore/Auth emulator 需要 JRE，已用 winget 裝 Microsoft OpenJDK 21 並加進 PATH。
- **`web/.env.local` 的 `VITE_USE_EMULATORS`**：`true` 連本機 emulator、`false` 連雲端 Firestore（2026-09-24 起本機設為 `false`）。已排除在 `.gitignore`，2026-09-24 已在 `firebase.ts` 加上 `import.meta.env.DEV` 判斷，正式建置不會誤連 emulator。
- **本機開發**：repo 根目錄 `npm run dev` 只開 Vite :5300，直接讀寫雲端 Firestore（⚠️ 本機操作會寫進正式資料）。要隔離測試：`.env.local` 改 `true` 後 `npm run dev:emulator`（`scripts/dev-local.ps1`＝junction 啟動 emulator，資料存 `.emulator-data/` → 首次自動灌種子 → 中文路徑啟動 Vite）；重灌用 `npm run dev:emulator:reset`；emulator 視窗要用 Ctrl+C 關才會存檔。
- **設計系統預覽**：本機 http://localhost:5300/#/design-system
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
| 管理員後台 | ✅ | 訂單總覽／撥款總覽／系統設定／解封申訴／廠商管理（申請審核＋`owner_uid` 綁定）都接真 Firestore |
| 權限控管／Firestore 安全規則 | ✅ | `firestore.rules`，新規則待部署（待辦 §2） |
| 商家後台儀表板 | 🟡 | 含撥款區塊＋手動觸發按鈕；需要綁定 `owner_uid` |
| 商家校準報告呈現（含 what-if 追問） | 🟡 | Gemini Key 已到位，待部署後在正式站驗證 |
| 通知系統（FCM） | 🟡 | 同 Donna「取餐提醒推播」 |
| 會員／身分驗證（手機門號 OTP） | 🟡 | Email＋密碼、OTP 兩種都已接真實 Firebase Auth；OTP 待 Console 手動啟用＋部署後在正式站驗證，見待辦 §6 |
| ISO27001 | 🟡 | 技術面已修補並部署；ISMS 管理制度文件 v1 已完成；剩餘項目（CSP 改強制、2FA、API key referrer、Audit Logs、branch protection）見待辦 §5 |

---

## UI 草圖對照

UI 草圖：https://claude.ai/artifact/WyPDxzfSrUG2ZA4M3EDrJc （只參考版面骨架與資訊架構，配色和字體不採用）。三頁（Main/Marketplace/MyBookings）共用 3 項主導覽「預購鎖定／轉讓市集／我的商品」；`PlanSchedule.dc.html` 已合併進 `Main.dc.html`。

| 草圖頁 | 現有對應 | 狀態 |
|---|---|---|
| `PlanSchedule.dc.html`（合作店家與計畫） | `HomePage.tsx` | ✅ 讀真實 `vendors`／`meal_plans` |
| `Main.dc.html`「預購鎖定」 | `HomePage.tsx` | ✅ 「今日推薦鎖定方案」呼叫 `createLinePayReservation`，套用早鳥折扣 |
| `Marketplace.dc.html`「轉讓市集」 | `TransferMarketPage.tsx`（`/marketplace`） | ✅ 瀏覽／接手／免費領取／我的轉讓／取消轉讓都接真 Firestore |
| `MyBookings.dc.html`「我的商品」 | `MyBookingsPage.tsx`（`/my-bookings`） | ✅ 資料驅動的週曆；使用（QR）／贈送／交易／回饋都接真 Firestore |
| `Login.dc.html`（手機門號 OTP） | `LoginPage.tsx` | 🟡 Email＋密碼、OTP 都已完成，待 Console 啟用＋部署後驗證 |
| `VendorDashboard.dc.html`（商家後台） | `VendorPortalLayout.tsx` 系列 | 🟡 備料、成長獎勵、菜單接真資料；揪團場次類頁面仍是 mock（待辦 §7） |

---

## 測試帳號

2026-09-24 起 `/login` 是真實 Firebase Auth（Email＋密碼），不再用帳號字串猜角色。登入後一律先進 `/home`，右上角下拉選單依角色顯示後台入口。

**本機 emulator**（`scripts/seed.js` 在 emulator 裡自動建立，正式站不會有；`web/.env.local` 要設 `VITE_USE_EMULATORS=true`）：

| 角色 | 帳號（Email） | 密碼 | 說明 |
|---|---|---|---|
| 一般會員 | customer@bunnbaa.test | demo1234 | 會員中心 `/profile` |
| 廠商 | vendor@bunnbaa.test | demo1234 | 綁定 `cafe-renheya-demo`（仁和雅咖啡），廠商後台 `/vendor-portal/dashboard`、核對取餐 `/lock/vendor/redeem` |
| 管理員 | suw192336@gmail.com | demo1234 | 管理後台 `/admin/vendors`（emulator 內的同名帳號，跟正式站密碼無關） |
| 廠商申請中 | applicant@bunnbaa.test | demo1234 | 已送出「早安三明治」申請，登入管理員到 `/admin/vendors` 核准後才會變成廠商 |

瀏覽不用登入，但鎖定／下單／結帳／轉讓接手／抽獎都要先登入（沒有匿名身分了）。

種子資料的商家訂閱：仁和雅咖啡＝訂閱中（20 天後續約）、王媽媽便當＝試用中（5 天後到期）、阿嘉炸雞＝已申請取消（3 天後暫停）、早安三明治＝未設定（核准 applicant@ 時開始試用）。

已經有 `.emulator-data` 存檔的話不會自動重灌，兩種做法擇一：`npm run dev:emulator:reset`（清掉重灌），或 emulator 開著時另開終端機執行
`$env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"; $env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"; $env:GCLOUD_PROJECT="bunnbaa-mvp-5474"; node scripts/seed.js --catalog-only`（只補帳號跟目錄資料，不重複灌歷史紀錄）。

**正式站**：只有管理員 `suw192336@gmail.com`（密碼由帳號持有人保管，不寫在 repo）。會員自行在 `/login`「會員註冊」建立；廠商帳號流程見待辦 §4「正式站商家帳號綁定」。

---|---|---|---|
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
