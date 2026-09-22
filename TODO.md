# BunnBaa 開發 TODO

對應文件：`../../BunnBaa_0到1架構文件.docx`（唯一權威文件）、`BunnBaa_技術規格文件_v6_消費者端補強版.docx`、`BunnBaa_現有雛型改造指南.docx`。舊雛型參照：`../../BunnBaa Parse_Ref/`。

---

## 🔴 最優先：3 個外部卡點（全部需人工處理，卡住下游一堆模組）

1. **Blaze 方案升級**（需綁信用卡，[Firebase Console](https://console.firebase.google.com/)）
   卡住：QR 核銷正式站、撥款排程正式站、整合測試、Hosting 重新部署（轉賣／撥款／新版首頁等功能都還沒上線）
   - [ ] 手動完成信用卡綁定 → 啟用 Cloud Functions → 部署 `functions/` → 重新 `firebase deploy --only hosting`

2. **Gemini API Key 手動申請**（[aistudio.google.com/apikey](https://aistudio.google.com/apikey)）
   卡住：兩個 AI Agent（商家校準／消費者折扣說明）、商家校準報告端到端驗證
   - [ ] 自動化申請會被 Google 判定可疑請求擋下，需人工手動點「Create API key」→ 選 GCP 專案 `bunnbaa-mvp-5474`（已 import 進 AI Studio）→ 建立 → 貼進 `functions/.env`（複製自 `functions/.env.example`）

3. **LINE Pay／綠界特約商店審核**（業務面，非工程能代勞，審核可能數週）
   卡住：金流串接(消費端)
   - [ ] 盡快送件，避免卡到最後一週才發現金流串不上

---

## 📌 環境備忘（新機器 / 新 session 開工前先看）

- **帳號**：GCP/Firebase 專案掛在 `ckchildlikekid@gmail.com`（鍾雅婷），**不是** `tom040798@gmail.com`。CLI 登入、瀏覽器操作都要用前者，否則 `firebase projects:list` 會顯示空的。
- **路徑雷**（專案路徑含中文字和 `+` 號，Windows 上兩個工具行為相反）：
  - Firebase emulator（`firebase emulators:start --only functions,...`）在中文路徑下會卡在 discovery timeout → 已建 ASCII junction `C:\Users\USER\bunnbaa-dev`，**跑 emulator 要 cd 到這裡**。
  - Vite dev server（`npm run dev`）從 junction 路徑跑會空白頁 → **要留在原本中文路徑** `.../bunnbaa-prototype/bunnbaa/web`。
- **Java**：Firestore/Auth emulator 需要 JRE，已用 winget 裝 Microsoft OpenJDK 21 並加進 PATH（新終端機應會自動抓到）。
- **`web/.env.local` 裡 `VITE_USE_EMULATORS=true`**：會讓前端連本機 emulator。已排除在 `.gitignore`，但正式部署前記得確認本機建置沒誤連 emulator。
- **網域**：`bunnbaa.com` 掛在舊專案（Parse 版本），這次 MVP 先不動，暫用 `bunnbaa-mvp-5474.web.app`。之後要換網域再處理 DNS。
- **GitHub**：獨立 private repo，不跟舊專案共用：https://github.com/Donna12301230/bunnbaa-mvp

---

## 模組總覽（依負責人分類，2026-09-18 確認分工）

狀態圖例：✅ 已完成／🟡 部分完成或程式碼完成但未測未部署／🔴 卡住（等人工或外部審核）／⬜ 本文件未提及或尚未開始

### Donna 負責（15 項）

**🟡 部分完成 / 程式碼完成但未測未部署（8）**
- 轉賣流程（交易核心）：`claimResoldLock`，兩個匿名帳號互接手已測過
- 轉賣金流(買家對買家)（金流與結算）：設計上不經過平台，只轉移 `buyer_uid`，已測
- Firebase 專案建置（基礎建置）：專案／Firestore／Auth／Hosting／安全規則都已上線，卡在 Blaze 升級（見上方卡點 1）
- 鎖定＋付款流程（交易核心）：「鎖定」本身已端到端驗證；「付款」要串真金流，見金流與結算
- QR Code 核銷（交易核心）：emulator 已驗證，因 Functions 未上 Blaze 尚未上正式站（正式環境呼叫 `markLockOutcome` 會失敗）
- 撥款排程（金流與結算）：`settleVendorPayouts`（daily schedule + 手動觸發）emulator 已驗證重複點擊不會重複結算，卡在 Blaze/Functions 部署未上正式站
- Firebase Hosting 部署（整合與交付）：已有初版正式站 https://bunnbaa-mvp-5474.web.app，但轉賣/撥款等新功能還沒重新部署（等 Functions 上線後一起做）
- 取餐提醒推播(FCM)（交易核心，同 SU「通知系統」，合併計算）：2026-09-20 SU 完成程式碼——前端要求通知權限+存 FCM token 到私有的 `lock_tokens`（`web/src/lib/messaging.ts`）、Functions 端 `pickupReminders`（每 15 分排程）+ `triggerPickupRemindersNow`。卡兩點：VAPID key 還沒去 Console 拿（免費、跟 Blaze 無關，見下方）；Functions 部署卡 Blaze。
- 我的鎖定/訂單記錄頁（交易核心）：2026-09-22 完成，新增 `MyLocksPage.tsx`（`/my-locks`，從「會員中心」連過去）——依 `buyer_uid` 查真實 `locks` 的簡易列表，不是週曆版面。emulator/正式站尚未實測（開發環境連不到外網 Firebase，見下方進度日誌）

**🔴 卡住，等人工或外部審核（3）**
- Gemini — 商家校準 Agent（AI Agent）：見上方卡點 2
- Gemini — 消費者折扣說明 Agent（AI Agent）：同上，目前消費者端會卡在「產生說明中」
- 金流串接(消費端)（金流與結算）：見上方卡點 3

**⬜ 未開始 / 本文件未提及（3）**
- UI模型建置（基礎建置）：新增項目，本文件尚無內容，需另外確認範圍與進度。UI規格書 https://claude.ai/artifact/QWUhndBuB4GS7izdStzXa8
- 整合測試（整合與交付）：未開始，待 Blaze 升級解除後才能做完整端到端測試
- Demo 錄製 ＋ Proposal（整合與交付）：未開始，**10/18 前提交**

-------------------------------------------------------------------------------

### SU 負責（11 項）

**✅ 已完成（4）**
- 商品(鎖定品項)列表頁（商品／瀏覽）：2026-09-20，`VendorPage.tsx` 兼做單一商家的品項列表，串接 `mockVendors`/`mockMenuItems`，已在瀏覽器測過完整流程
- 商品詳情頁（商品／瀏覽）：`MenuItemPage.tsx`（`/item/:id`），含備註、數量、加入購物車（`useCart`），已測過
- 商家清單／商家頁（商品／瀏覽）：`VendorListPage.tsx`（`/vendors`，搜尋+清單）+ `VendorPage.tsx`（`/vendor/:id`，商家頁），從首頁「商家」分頁 + 「合作店家與計畫」卡片都可以點進去，已測過
- 管理員後台（管理後台）：2026-09-20 重做，整合進雅婷的 `AdminLayout` 側邊欄（`/admin/locks`／`/admin/payouts`／`/admin/settings`），廠商管理／解封申訴維持原本 mock 版本不動（解封申訴本次不做）。這三個新分頁動的是真實 Firestore：訂單總覽可跨商家篩選+覆寫狀態、撥款總覽唯讀、系統設定顯示管理員清單。因為平台登入(mock)跟 Firestore 安全規則(真實 Firebase Auth)是兩套系統，另外包了 `RequireRealAdmin` 擋一次真實帳密登入。已測：側邊欄五項都正常、訂單總覽能看到真實鎖定紀錄並操作。

**🟡 部分完成（6）**
- 權限控管（基礎建置）：即 `firestore.rules`，已部署（跟「系統與安全」的 Firestore 安全規則是同一件事）
- 商家後台儀表板（商家後台）：含撥款區塊 + 手動觸發按鈕
- Firestore 安全規則（系統與安全）：已完成並部署
- 會員／身分驗證(輕量,手機門號 OTP)（基礎建置）：目前用匿名登入，已驗證鎖定流程可跑；規格要的手機門號 OTP 本文件未提到是否已做
- 商家校準報告呈現(含 what-if 情境追問互動)（商家後台）：`runCalibrationForVendor` 邏輯與徽章自動換算都寫好，但要真的產出報告需要 Gemini Key（見上方卡點 2），目前卡住未端到端測過
- 通知系統(FCM 取餐提醒,同 Donna「取餐提醒推播」,合併計算)（系統與安全）：2026-09-20 完成程式碼，詳見 README「尚未實作」清單。卡點：VAPID key 待補、Functions 部署卡 Blaze

**🔴 卡住，等人工或外部審核**
- （無）

**⬜ 未開始 / 本文件未提及（0）**

**🟡 ISO27001（系統與安全）**：2026-09-21 完成技術面落差分析＋修補，詳見 [ISO27001_落差分析.md](ISO27001_落差分析.md)。已補：Functions 授權（管理員／商家 owner）、`payouts`／`accuracy_reports` 限管理員與該商家 owner 可讀（`vendors/{id}.owner_uid` 綁定，商家儀表板改為需登入）、FCM token 私有化、`locks` 完整性規則、管理員稽核日誌、Hosting 安全標頭。`firestore.rules` 與前端已於 2026-09-21 部署上線（規則以未登入 REST 請求驗證過：敏感集合回 403）。**待辦**：下方煙霧測試；錄 demo 前照文件「商家帳號綁定」流程建商家帳號並設 `owner_uid`（否則商家儀表板看不到資料）；認證所需的 ISMS 管理制度文件尚未建立

**ISO27001 上線後煙霧測試（2026-09-21 以 Chrome 擴充功能實測）**
- [x] 開 https://bunnbaa-mvp-5474.web.app/#/lock，按「鎖定這份」，看到取餐 QR code 即成功（通過，測試單 `9MNIFR3H`）
- [x] `/#/login` 用 `admin@test.com`（密碼任意）登入平台 → 開 `/#/admin/locks` → 用真實管理員帳號（`suw192336@gmail.com`）登入 → 對一筆訂單按「標記已完成取餐」再「退回鎖定中」還原（通過，兩次狀態切換皆成功、Console 無錯誤）
- [ ] Firestore Console 確認 `admin_audit_logs` 多了兩筆（含 admin_email 與狀態變化）——**尚未親眼確認**：程式為單一 `writeBatch`（狀態更新與稽核紀錄同成敗），兩次切換都成功，理論上兩筆都已寫入，但需在 Console 看過才算數
- [x] 瀏覽器 F12 Console 檢查有無 `Content-Security-Policy-Report-Only` 違規（通過：重新載入後無 CSP 違規、無 error；唯一警告是 `VAPID_KEY not set`，屬預期，見上方 FCM 卡點）
- [ ] 長期觀察無 CSP 違規後，把 `firebase.json` 的 `Content-Security-Policy-Report-Only` 改為 `Content-Security-Policy`（目前只測過 `/lock` 與兩個 mock 管理頁，尚未涵蓋所有頁面）
- [ ] Console 手動項目：帳號 2FA、Firebase API key 加 referrer 限制（`bunnbaa-mvp-5474.web.app/*`、`bunnbaa-mvp-5474.firebaseapp.com/*`、`localhost:*`，存檔後立刻重測正式站）、Cloud Audit Logs 開資料讀寫、GitHub `master` branch protection（需先與雅婷討論改走 PR）

---

## UI 草圖對照（設計稿 vs 現有頁面）

UI 草圖：https://claude.ai/artifact/WyPDxzfSrUG2ZA4M3EDrJc （僅參考版面骨架與資訊架構，配色/字體不採用，其他 UI 依照原模型）

導覽骨架：草圖三頁（Main/Marketplace/MyBookings）共用同一組 3 項主導覽「預購鎖定／轉讓市集／我的商品」。`PlanSchedule.dc.html` 已被合併進 `Main.dc.html`，不當獨立頁面處理。

### 逐頁狀態

| 草圖頁 | 現有對應 | 狀態 |
|---|---|---|
| `PlanSchedule.dc.html`（合作店家與計畫） | `HomePage.tsx` | ✅ 已一比一做出來 |
| `Main.dc.html`「預購鎖定」 | 2026-09-21 補進 `HomePage.tsx` | 🟡 版面＋互動骨架完成，**尚未接後端**——真正端到端接 Firestore 的示範仍在 `/lock`（`ConsumerLockPage.tsx`），兩邊還沒合併 |
| `Marketplace.dc.html`「轉讓市集」 | `TransferMarketPage.tsx`（`/marketplace`） | 🟡 2026-09-22 接上真實 Firestore：瀏覽轉讓／我要接手（`claimResoldLock`）／免費領取／我的轉讓皆已是真實查詢與寫入。**尚未接後端**：「取消轉讓」（firestore.rules 沒有對應規則讓 owner 把 `for_resale` 改回 `locked`）；已被接手的項目也無法在「我的轉讓」追蹤（資料模型沒記錄原轉讓者） |
| `MyBookings.dc.html`「我的商品」 | `MyBookingsPage.tsx`（`/my-bookings`） | 🟡 版面＋互動骨架完成（21 格週曆），資料是寫死 mock，**尚未接後端**：核銷要串 `markLockOutcome`、「贈送」指名轉移沒有對應 Function、「留下回饋」無資料模型 |
| `Login.dc.html`（手機門號 OTP 兩段式） | `LoginPage.tsx`（`mockAuth.ts` 帳號字串猜角色） | 🟡 草圖確認要 OTP 流程，尚未做 |
| `VendorDashboard.dc.html`（商家後台：訂單/備料/收益/成長獎勵） | 既有 `VendorPortalLayout.tsx` 系列 + 新增備料/成長獎勵頁 | 🟡 見下方「全新機制」 |

### 草圖裡後端還接不上的功能（待辦清單）

- [x] 逾時自動開放 $0 元領取（Marketplace）——2026-09-22 完成：沿用既有 firestore.rules 的 lazy expiry 規則（不用排程 Function），`TransferMarketPage.tsx` 已接上真實 `locks` 查詢＋`claimResoldLock`／免費領取
- [ ] 取消轉讓（Marketplace「我的轉讓」）——firestore.rules 沒有對應規則，2026-09-22 盤點時發現
- [ ] 贈送給指定朋友（MyBookings「贈送」）——現有機制只支援不指名的市集轉讓
- [ ] 留下回饋／評論（MyBookings 過去餐點）——不缺資料模型（沿用 `Lock.consumer_feedback`，規則已支援，範例見 `ConsumerLockPage.tsx`），但 2026-09-22 盤點發現 `MyBookingsPage.tsx` 整頁週曆都是寫死 mock、完全沒接真實 `locks`，要接這個得先把整頁重新接上真實資料（比預期大的工程，非單純加欄位）
- [ ] 計畫型（訂閱制多日方案）——僅 `mockVendorMealPlans` 前端假資料，Firestore 無 plan／多日排程模型
- [ ] 認證商家徽章——目前只有 `reliability_tone`（履約穩定度），沒有「認證商家」欄位
- [x] 早鳥階梯定價 95/8/7 折——2026-09-22 完成，`web/src/lib/pricing.ts`（純函式，可測），已接進 `ConsumerLockPage.tsx` 的 `handleLock()`。`HomePage.tsx` 的 `mockLockMeals` 卡片是純前端 mock、還沒接真實下單流程，沒有一併套用
- [ ] `growth_rewards`／`draws` collection 重新設計（商家累積營收門檻、開獎紀錄）；抽獎機率計算必須在 Cloud Function 做，不能信任 client
- [x] 備料聚合改成依 `locks` collection 的 `pickup_date` + `pickup_window` 即時分組——2026-09-22 完成，`VendorPortalPrep.tsx` 改用 `onSnapshot`

QR 核銷碼（MyBookings「使用」面板）已有對應實作可沿用：`LockQRCode.tsx` + `VendorRedeemPage.tsx`。

**建議順序**：`Marketplace.dc.html`（`claimResoldLock` 後端已存在）→ `MyBookings.dc.html`（互動最重、最依賴目前還不存在的資料模型）。

---

## 環境搭建剩餘步驟

- [x] Firebase 專案建立
- [x] `firebase use --add` 連結專案，產生 `.firebaserc`
- [x] 啟用 Firestore（asia-east1）、Authentication（匿名登入）
- [x] 部署 `firestore.rules` 和 `firestore.indexes.json`
- [ ] 升級到 Blaze 方案 → 啟用 Functions（見上方卡點 1）
- [x] 啟用 Hosting：`web/` 已 build 並部署，https://bunnbaa-mvp-5474.web.app （正式環境 Firestore 是空的，還沒 seed demo 資料；等要錄 demo 前再灌資料）
- [ ] 申請 Gemini API Key（見上方卡點 2），填入 `functions/.env`
- [x] 把 `web/src/lib/firebase.ts` 的 `firebaseConfig` 換成真實專案設定值
- [x] 本機用 emulator 跑通：消費者端「鎖定這份」流程已驗證（匿名登入、Firestore 寫入、`onLockCreated` 觸發都正常，只差 Gemini Key 導致折扣說明卡在「產生說明中」）

已完成：`functions/` 和 `web/` 的 npm 依賴都裝好，四個 Cloud Functions 檔案語法確認正常，`web` 補了缺失的 `vite-env.d.ts`，`npx tsc --noEmit` 已過。

---

## 骨架裡尚未實作的功能（見 `README.md`「尚未實作」清單）

- [x] 轉賣流程實際 UI（`claimResoldLock`，emulator 端到端測過，含兩個匿名帳號互相接手）
- [x] 履約穩定度徽章自動換算（`runCalibrationForVendor` 算完 accuracy_rate 自動更新 `reliability_tone`）——**還沒端到端測過**，需 Gemini Key 才能真的跑出報告
- [ ] 取餐時段推播提醒（spec §3.7，FCM，跟 AI 無關的純 UX）
- [x] 商家後台標記 no-show／備註介面（`/vendor/redeem`，`VendorRedeemPage.tsx`，emulator 已驗證）

## 之後的工作（照架構文件時程表順序）

- [x] 從 `BunnBaa Parse_Ref` 複製可沿用的前端元件（QR 核銷、react-hook-form+zod 表單、Cloudinary 上傳元件已搬過來但還沒接到任何頁面）
- [x] 商業邏輯用「參照不複製」原則檢視完成
- [x] 金流串接（假資料版）：`settleVendorPayouts`（全額撥款商家，無平台抽成，daily schedule + 手動觸發，emulator 端到端測過含重複點擊防護）；轉賣金流不經過平台（買家對買家私下付款，平台只轉移 `buyer_uid`）
- [ ] 整合測試 → 部署 Firebase Hosting → 錄 Demo（3 分鐘腳本見 v6 §8）→ 撰寫英文版 Proposal → **10/18 前提交**（Hosting 還沒重新部署最新的轉賣/撥款功能）

---

## 測試帳號（角色分流，2026-09-18）

`/login` 目前是 `mockAuth.ts` 的假登入，不驗證密碼，純粹依「帳號」字串判斷角色：帳號含 `admin` → 管理員、含 `vendor` → 廠商、其餘 → 一般會員。登入成功後一律先進首頁（`/home`），右上角使用者下拉選單依角色顯示不同後台入口：
- 一般會員：只看到「會員中心」（`/profile`）
- 廠商：多一個「廠商後台」（`/vendor-portal/dashboard`）
- 管理員：多一個「管理後台」（`/admin/vendors`）

| 角色 | 帳號 | 密碼 |
|---|---|---|
| 一般會員 | customer@test.com | 任意 |
| 廠商 | vendor@test.com | 任意 |
| 管理員 | admin@test.com | 任意 |

之後接上真的 Firebase Auth／正式身分驗證時，這套「帳號字串猜角色」的 mock 邏輯要整個換掉，`role` 改成從 Firestore `users/{uid}` 文件讀。

---

## 本次不做（列入路線圖，不要誤觸）

揪團（GroupOrder）、現場點餐（TableOrder）、申訴機制（BanAppeal）、多站點美食地圖——全部留在舊 repo，不影響本次原型範圍。

---

## 進度日誌（歷史記錄，僅供追溯；最新在上）

**2026-09-22（第二次更新）：新增 `MyLocksPage.tsx`（我的鎖定紀錄）＋早鳥階梯定價邏輯 `pricing.ts`**

延續上一次「先做不受三大卡點影響的項目」的方向：
- 「我的鎖定/訂單記錄頁」原本本文件沒描述範圍，跟使用者確認後決定做一個獨立的真實資料簡易列表頁（不是週曆版面）：新增 `MyLocksPage.tsx`（`/my-locks`），依 `buyer_uid` 查真實 `locks`（單一 equality，不加 `orderBy`，避免要求新複合索引，排序交給前端），從「會員中心」（`ProfilePage.tsx`）新增「我的鎖定紀錄」卡片連過去。之後可以當作把 `MyBookingsPage.tsx` 從 mock 換成真資料的中間步驟
- 早鳥階梯定價：新增 `web/src/lib/pricing.ts`（純函式 `applyEarlyBirdPrice`，對應 `HomePage.tsx` 側欄「早鳥預約折扣」顯示的三個階梯：今日/明日 95折、提前2–13天 8折、提前14–30天 7折），接進 `ConsumerLockPage.tsx` 的 `handleLock()` 取代原本寫死的 `discount_percent: 20` / `locked_price: 96`（跟側欄階梯不一致的舊值）。瀏覽器實測 `/lock` 正確顯示「今日／明日・95折 → NT$114」
- `npx tsc --noEmit` 零錯誤；`/my-locks` 頁面渲染正常（沙盒連不到外網 Firebase，卡在 auth 匿名登入無法解析，停在「載入中」——跟前次 `TransferMarketPage.tsx` 遇到的環境限制相同，不是程式碼問題）

**2026-09-22：`VendorPortalPrep.tsx`／`TransferMarketPage.tsx` 接上真實 Firestore（不受三大卡點影響的項目優先做）**

盤點 TODO 後，先挑不受 Blaze／Gemini／LINE Pay 三大卡點影響、純 Firestore client 讀寫就能做完的項目：
- `VendorPortalPrep.tsx`（今日備料）：改用 `onSnapshot` 監聽 `locks`，沿用 `VendorRedeemPage.tsx` 同一組 `vendor_id + created_at` 索引（不用新增複合索引），前端過濾今日 `pickup_date` 且排除 `fulfilled`／`resold_and_fulfilled`／`no_show`，依 `pickup_window` → `item_name` 即時分組計數。刪除已無用的 `mockPrepSlots`
- `TransferMarketPage.tsx`（轉讓市集）：沿用 `ConsumerLockPage.tsx` 已驗證過的模式——「瀏覽轉讓」「已逾期開放$0元」改成即時查詢真實 `for_resale` 的 `locks`；「我要接手」呼叫 `claimResoldLock`（正式站要等 Blaze，emulator 可先測）；「免費領取」是純 client-side firestore.rules 寫入，不用排程、不受 Blaze 卡住；「我的轉讓」改查真實資料，但誠實標註「取消轉讓」目前 rules 不支援、已被接手的項目也追蹤不到（資料模型沒記錄原轉讓者），不做假按鈕。刪除已無用的 marketplace mock 資料
- 盤點時發現 `MyBookingsPage.tsx`（我的餐點）整頁週曆完全是寫死 mock，沒有真實 `locks` 串接，「留下回饋」看似只差一個欄位（`Lock.consumer_feedback` 早就有規則支援），實際要接得先把整頁重新接上真實資料——比預期大得多，先跳過，改做上面兩項
- `npx tsc --noEmit` 零錯誤；瀏覽器實測兩頁面渲染正常、loading/空清單狀態正確；比對既有已驗證的 `/lock` 頁面確認 `Firestore Listen...transport errored` 是這次測試所在的瀏覽器沙盒連不到外網 Firebase，不是程式碼問題

**2026-09-21（第六次更新）：`/lock/vendor/redeem`（核對取餐）加上取餐總覽日曆格**

第五次改成 Tailwind 後使用者反饋「太陽春」，希望跟消費端一樣有行事曆格式：
- 新增「取餐總覽」區塊——即時監聽（`onSnapshot`）該商家最近 200 筆 lock，依取餐日期（欄）× 取餐時段（列）排成跟 `MyBookingsPage.tsx` 同樣邏輯的日曆格；每格是可點的小卡片（品項/狀態徽章/價格）
- 點卡片＝`selectLock()`，直接帶入下面既有的核對結果卡（狀態、確認取餐、登記未取餐），跟手動輸入編號查詢共用同一套 `markOutcome` 邏輯，沒有另外寫一套
- 查詢索引沿用既有的 `vendor_id + created_at` 複合索引（`firestore.indexes.json` 已有），日曆格用同一組查詢結果分組，沒有另外要求新索引
- 瀏覽器實測：在 `/lock` 真的鎖定一筆，日曆格即時抓到並正確分組顯示；點卡片能正確帶入查詢結果；按「確認取餐」有觸發 `markLockOutcome` 呼叫（正式環境因 Functions 未上 Blaze 會失敗，這是既有已知卡點，不是這次改動造成的）。`npx tsc --noEmit` 零錯誤

**2026-09-21（第五次更新）：`/lock/vendor/redeem` 換成 Tailwind/shadcn，跟全站一致**

`/lock/vendor/redeem`（核對取餐）原本是 `legacy-ui` 純 CSS（跟 `/lock`、`/lock/vendor` 同一套舊風格），透過主導覽點進去後風格落差明顯：
- `VendorRedeemPage.tsx` 全部換成 Card/Input/Button/Badge/Label/Separator，版面參照同類型的 `VendorPortalScan.tsx`；狀態徽章另外定義 `LOCK_STATUS_STYLE`（`lib/statusMap.ts` 是給 PreOrder 用的，欄位對不上 Lock 狀態機）
- 加上 `<MarketplaceHeader active="bookings" />`，`App.tsx` 拿掉這條路由的 `legacy-ui` 包裝
- 邏輯完全沒動——Firestore 查詢、`markLockOutcome` 呼叫、react-hook-form+zod 驗證原封不動，只換 JSX/className
- 瀏覽器實測：畫面一致、查詢邏輯沒被改壞（正式 Firebase 查無結果時錯誤提示正確顯示）。`npx tsc --noEmit` 零錯誤

**2026-09-21（第四次更新）：`/vendors` 導覽統一、「我的商品」改名「我的餐點」＋角色分流、刪除舊 `Navbar.tsx`**

- 首頁「轉讓優惠」併進「同學轉讓保底專區」，移到 `HomePage.tsx` 最下面合成一個橘色卡片
- `/vendors`、`/vendor/:id`、`/item/:id`（共用 `CustomerLayout.tsx`）原本掛另一套 `Navbar.tsx`（購物車／我的訂單／我的開團連結都指向不存在的路由，會 404），改成跟其他頁共用 `MarketplaceHeader`（新增 `"vendors"` active 狀態）
- 「我的商品」改名「我的餐點」，並依角色分流（`MarketplaceHeader.tsx`）：一般使用者顯示「我的餐點」連到 `/my-bookings`；廠商（`isVendor`）這個分頁位置換成「核對取餐」連到 `/lock/vendor/redeem`——真的接 Firestore 核銷 `locks` 的商家端頁面，跟消費端 `MyBookingsPage.tsx`「使用」面板的核銷碼是同一套機制的兩端
- 刪除已無引用的 `components/Navbar.tsx`
- 驗證：mock auth 登入態存在模組記憶體變數，只改 URL hash 不會刷新，改用 `localStorage.setItem` + `location.reload()` 切換角色測試，確認 vendor／一般帳號各自看到正確分頁。`npx tsc --noEmit` 零錯誤

**2026-09-21（第三次更新）：`Main.dc.html`「預購鎖定」補進 `HomePage.tsx`**

發現 `Main.dc.html` 現在是合併版（`PlanSchedule.dc.html` 已併入），`HomePage.tsx` 早已做出計畫方案那一半，這次只缺「今日推薦鎖定方案」單點型卡片區＋側欄新增內容。沒有另開新頁面（`/home` 在全站 8 處被當成回首頁的通用錨點），直接加進既有 `HomePage.tsx`：
- 側欄新增：取餐時段（單一日期+3段 radio）、保障說明／取餐提醒提示框、進階篩選（純裝飾）
- 主區新增「今日推薦鎖定方案」3 卡片：認證商家＋履約穩定度雙徽章、Gemini 折扣說明框、消保法免責 checkbox（未勾則 disabled）、逾時警示、鎖定後變綠色狀態
- 主區底部新增「同學轉讓保底專區」CTA 橫幅，連到 `/marketplace`
- mock 資料：`mockData.ts` 新增 `mockLockMeals`（3 個品項）
- 刻意沒跟 `/lock`（`ConsumerLockPage.tsx`）真實 Firestore 邏輯合併——那頁是 10/18 demo 要用的端到端示範，這次新增純版面+local state（`handleToggleLock` 只彈 toast）。之後要接可照 `ConsumerLockPage.tsx` 的 `handleLock()` 模式擴充成多品項版本
- `npx tsc --noEmit` 零錯誤；`npm run dev` 實際跑過驗證版面與互動正確

**2026-09-21（第二次更新）：草圖新增「商家後台」`VendorDashboard.dc.html`**

草圖新增第 6 張 artboard，4 個分頁：訂單／備料／收益及未來備料趨勢／成長獎勵。比對後發現只有「備料」「成長獎勵」是全新機制，其餘跟既有廠商後台（`VendorPortalLayout.tsx` + `pages/vendor-portal/*`）重疊。已加入：
- 新增 `pages/vendor-portal/VendorPortalPrep.tsx`（`/vendor-portal/prep`，今日備料，mock `mockPrepSlots`）
- 新增 `pages/vendor-portal/VendorPortalGrowth.tsx`（`/vendor-portal/growth`，成長獎勵，mock `mockGrowthRewards`）——商家累積合作營收達門檻（20萬解鎖單抽／100萬解鎖十連抽），消費者可抽中折扣券（8/6/5/3/1折或整份0元）
- `VendorPortalReports.tsx` 補上「校準洞察」卡片——這份 Gemini 校準報告其實已在 `/lock/vendor`（`VendorDashboard.tsx`）真的串了 Firestore + `askCalibrationScenario`，只是卡在 Gemini Key／Blaze 沒部署，之後直接接既有 Function 即可
- 新增 `components/GrowthRewardTicker.tsx`，掛在 `HomePage.tsx` header 下方廣播中獎跑馬燈
- 「訂單」分頁沒有另外做（跟既有「訂單管理」重疊，草圖是鎖定制視角，等主線需求明確再決定）
- Main 草圖新增的「商家後台 →」header 快速連結**沒有照抄**——現有 app 用 `isVendor` 角色門檻擋在下拉選單裡，草圖那種永遠顯示的連結會讓一般會員也點得進去，故意不加
- `npx tsc --noEmit` 零錯誤，`vendor_test` 帳號實測通過

**2026-09-21（第一次進度）：`Marketplace.dc.html` / `MyBookings.dc.html` 版面完成**

依建議順序把版面做完（「請先改版面」）：
- 新增 `components/MarketplaceHeader.tsx`（從 `HomePage.tsx` 抽出的共用頂部列，三頁共用同一組導覽）
- 新增 `pages/TransferMarketPage.tsx`、`pages/MyBookingsPage.tsx`，掛進 `App.tsx`；`ProfilePage.tsx`「我的訂單」改導去 `/my-bookings`
- 兩頁都是版面＋前端 local state 骨架，互動都做得出來、有 toast 回饋，但沒寫回 Firestore；mock 資料在 `mockData.ts` 底部（`mockMarketplaceListings`／`mockMarketplaceReleased`／`mockMyMarketplaceListings`），每個 TODO(firebase) 註解都寫了要接哪個 Cloud Function
- 視覺沿用現有 Tailwind/shadcn 風格，符合「其他 UI 依照原模型」指示
- `npx tsc --noEmit` 零錯誤，`npm run dev` 瀏覽器實測一輪通過

**2026-09-20：SU 完成取餐提醒推播(FCM) / 通知系統程式碼**

前端要求通知權限+存 FCM token（`web/src/lib/messaging.ts`）、Functions 端 `pickupReminders`（每 15 分排程）+ `triggerPickupRemindersNow`。管理員後台重做整合進 `AdminLayout`。商品列表/詳情頁、商家清單/商家頁完成並測試通過（詳見上方模組總覽）。
