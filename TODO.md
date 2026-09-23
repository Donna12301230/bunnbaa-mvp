# BunnBaa 開發 TODO

對應文件：`../../BunnBaa_0到1架構文件.docx`（唯一權威文件）、`BunnBaa_技術規格文件_v6_消費者端補強版.docx`、`BunnBaa_現有雛型改造指南.docx`。舊雛型參照：`../../BunnBaa Parse_Ref/`。

---

## 🔴 最優先：3 個外部卡點（全部需人工處理，卡住下游一堆模組）

負責人備註：三項卡住的下游模組（QR 核銷／撥款／Gemini Agent／金流串接(消費端)）目前全部列在下方「Donna 負責」的 🟡／🔴 清單裡，SU 名下沒有項目直接卡在這三點——所以這三項人工待辦歸 **Donna**。

1. **Blaze 方案升級**（需綁信用卡，[Firebase Console](https://console.firebase.google.com/)）（Donna）
   卡住：QR 核銷正式站、撥款排程正式站、整合測試、Hosting 重新部署（轉賣／撥款／新版首頁等功能都還沒上線）
   - [V] 2026-09-23 手動完成信用卡綁定（過程中卡過一次「交易遭拒」，換卡/請銀行放行後成功）→ Blaze 已啟用
   - [V] 2026-09-23 `firebase deploy --only firestore:rules` 已部署（含取消轉讓、growth_rewards/draws 等新規則）
   - [V] 2026-09-23 `firebase deploy --only functions` 已部署全部 11 個 functions（`onLockCreated` 第一次卡 Eventarc 權限生效中，等待後重試成功）
   - [V] 2026-09-23 `firebase deploy --only hosting` 已重新部署，轉賣/撥款/成長獎勵抽獎等新功能正式上線 https://bunnbaa-mvp-5474.web.app
   
   **卡點 1 已解除。** 待辦：整合測試（見下方⬜清單）確認 QR 核銷、撥款排程等在正式站真的能跑；VAPID key 還沒補（FCM 推播卡最後一步）

2. **Gemini API Key 手動申請**（[aistudio.google.com/apikey](https://aistudio.google.com/apikey)）（Donna）
   卡住：兩個 AI Agent（商家校準／消費者折扣說明）、商家校準報告端到端驗證
   - [ ] 自動化申請會被 Google 判定可疑請求擋下，需人工手動點「Create API key」→ 選 GCP 專案 `bunnbaa-mvp-5474`（已 import 進 AI Studio）→ 建立 → 貼進 `functions/.env`（複製自 `functions/.env.example`）

3. **LINE Pay／綠界特約商店審核**（業務面，非工程能代勞，審核可能數週）（Donna）
   卡住：金流串接(消費端)正式上線（Sandbox 測試不受此卡住，見下方）
   - [ ] 盡快送件，避免卡到最後一週才發現金流串不上

   **2026-09-23 消費端金流改用 LINE Pay Sandbox 先行開發**：Sandbox channel 是開發者自助申請（免商業審核），已申請並填入 `functions/.env`（`LINE_PAY_CHANNEL_ID`/`LINE_PAY_CHANNEL_SECRET`/`LINE_PAY_ENV=sandbox`）。新增 `functions/src/linePay.js`（v3 簽章+Request/Confirm API）、`createLinePayReservation`／`confirmLinePayPayment` 兩個 Cloud Functions、`payment_intents` collection（`firestore.rules` 已鎖只有 Functions 能寫）、前端 `PaymentConfirmPage.tsx`／`PaymentCancelPage.tsx`（`/payment/confirm`、`/payment/cancel`）。`ConsumerLockPage.tsx`「鎖定這份」改成走 Request→導向 LINE Pay→Confirm 才建立 `locks` 文件，不再是原本的直接寫入。已實測 Request API 成功導向 LINE Pay Sandbox 登入頁；**待辦**：完整跑一次登入+確認付款，驗證 `confirmLinePayPayment` 有正確建立 `locks` 文件。正式審核過後只要把 `.env` 換成正式 Channel ID/Secret＋`LINE_PAY_ENV=production` 即可切換，程式碼不用改

   **2026-09-23 端到端測試中修掉兩個 bug**：
   1. hash 路由 404——LINE Pay 導回時用純字串串接把 `?transactionId=...` 加到我們給的 `confirmUrl` 後面，不理會 `#`（hash 路由分隔符），原本把 `orderId` 放在 `?query` 導致參數混進 hash 路徑讓 wouter 對不上路由。改成 `orderId` 放路徑（`/payment/confirm/:orderId`），用動態參數＋防禦性截斷吸收 LINE Pay 加的尾巴（`App.tsx`／`PaymentConfirmPage.tsx`）
   2. Confirm API 回「1159 交易不存在」——LINE Pay 的 `transactionId` 是 19 位數，超過 JS `Number` 安全整數範圍（16 位數），`res.json()` 解析時精度被四捨五入，存進 Firestore 的值跟 LINE Pay 實際的對不上。改用官方文件提到的技巧：解析回應前先把 `transactionId` 數字字面值加上引號再 `JSON.parse`，讓它以字串型態保留完整精度（`functions/src/linePay.js`）
   
   兩個修復都已部署，**2026-09-23 已完整跑通一次端到端測試**：真實個人 LINE 帳號登入 → 確認付款 → Firestore 驗證 `payment_intents`（`status: "confirmed"`，`transaction_id` 完整 19 位數無精度遺失）跟對應的 `locks` 文件（`status: "locked"`）都正確寫入。消費端金流 Sandbox 串接全部完成

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

**🟡 部分完成 / 程式碼完成但未測未部署（10）**
- 轉賣流程（交易核心）：`claimResoldLock`，兩個匿名帳號互接手已測過。2026-09-22 加上「取消轉讓」：`firestore.rules` 補規則讓 owner 把還沒被接手的 `for_resale`／`for_gift` 改回 `locked`，`TransferMarketPage.tsx`／`MyBookingsPage.tsx` 都接了真的取消按鈕——2026-09-23 規則已隨 Blaze 升級一起部署上正式站
- 轉賣金流(買家對買家)（金流與結算）：設計上不經過平台，只轉移 `buyer_uid`，已測
- Firebase 專案建置（基礎建置）：專案／Firestore／Auth／Hosting／安全規則都已上線，卡在 Blaze 升級（見上方卡點 1）
- 鎖定＋付款流程（交易核心）：2026-09-23 「付款」改接 LINE Pay Sandbox（見下方「金流串接(消費端)」），端到端測試通過（真實 LINE 帳號登入→確認付款→Firestore 正確寫入）
- QR Code 核銷（交易核心）：emulator 已驗證，2026-09-23 `markLockOutcome` 已隨 Functions 部署上正式站，待實際跑一次驗證
- 撥款排程（金流與結算）：`settleVendorPayouts`（daily schedule + 手動觸發）emulator 已驗證重複點擊不會重複結算，2026-09-23 已隨 Functions 部署上正式站，待實際跑一次驗證
- Firebase Hosting 部署（整合與交付）：已有初版正式站 https://bunnbaa-mvp-5474.web.app，但轉賣/撥款等新功能還沒重新部署——2026-09-23 Functions 已上線，重新部署 Hosting 排定接下來做
- 取餐提醒推播(FCM)（交易核心，同 SU「通知系統」，合併計算）：2026-09-20 SU 完成程式碼——前端要求通知權限+存 FCM token 到私有的 `lock_tokens`（`web/src/lib/messaging.ts`）、Functions 端 `pickupReminders`（每 15 分排程）+ `triggerPickupRemindersNow`。2026-09-23 Functions 已部署上正式站，仍卡：VAPID key 還沒去 Console 拿（免費、跟 Blaze 無關，見下方）。
- 我的鎖定/訂單記錄頁（交易核心）：2026-09-22 完成，新增 `MyLocksPage.tsx`（`/my-locks`，從「會員中心」連過去）——依 `buyer_uid` 查真實 `locks` 的簡易列表，不是週曆版面。emulator/正式站尚未實測（開發環境連不到外網 Firebase）
- 金流串接(消費端)（金流與結算）：2026-09-23 LINE Pay Sandbox 串接完成並部署，端到端測試通過；正式上線仍卡特約商店審核（見上方卡點 3）

**🔴 卡住，等人工或外部審核（2）**
- Gemini — 商家校準 Agent（AI Agent）：見上方卡點 2
- Gemini — 消費者折扣說明 Agent（AI Agent）：同上，目前消費者端會卡在「產生說明中」

**⬜ 未開始 / 本文件未提及（3）**
- UI模型建置（基礎建置）：2026-09-22 讀完 UI規格書（https://claude.ai/artifact/QWUhndBuB4GS7izdStzXa8 ，v1.0，2026-09-18）盤點範圍——**這份文件已經嚴重過時**，只涵蓋最早的單一商家鎖定 demo（`/`、`/vendor`、`/vendor/redeem`），完全沒提到後來長出來的首頁／轉讓市集／我的餐點／管理後台／商家後台等等。文件列的「開放問題」四項，三項已透過這幾天的工作解決（商家後台身分驗證、A4 取餐提醒排程、A3 賣方轉讓列表），只剩 B5（商家新增/編輯品項）還沒接 Firestore——但盤點後發現這牽出「兩套平行資料模型」的架構問題（見下方 SU 負責區塊），B5 本身先暫緩
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

**🏗️ 待決策：兩套平行的商家/品項資料模型**（2026-09-22 盤點 UI 規格書 B5「商家新增/編輯品項」時發現，範圍超出單次工作階段，先記錄）：「商品瀏覽」這條線（`VendorPage.tsx`／`MenuItemPage.tsx`／`VendorPortalMenu.tsx`／`CartPage.tsx`，SU 負責的「商品／瀏覽」「商家後台」模組，用 `VendorData`／`MenuItemData` 型別，從舊 `BunnBaa Parse_Ref` 雛型搬過來，含訂閱狀態／營業時段／桌位 QR 等「本次不做」清單裡揪團/現場點餐的殘留欄位）跟真正在跑的 `Lock`／`Vendor` 流程（`item_focus`／`reliability_tone`／`verified`，Donna 這幾天一直在接的 `cafe-renheya-demo`）是**兩套完全不相干、沒有互相引用的資料模型**。要接 Firestore 前得先決定：(a) `menu_items` 只接真實 `vendorId`（固定用 `cafe-renheya-demo`），維持跟 `VendorData`/訂閱系統分離；(b) 索性把整套「商品瀏覽」stack 併進真正的 `Vendor` 模型；(c) 這條線本來就屬於路線圖，這次不用管。決定前 `VendorPortalMenu.tsx` 的品項管理 UI 暫時維持 mock

**2026-09-23 購物車結帳採用選項 (a)，接上真實金流**：`CartPage.tsx`「送出預購」原本只是清空購物車＋toast 的示意畫面，完全沒寫入任何資料庫。這次改成真的呼叫 LINE Pay（新增 `createCartLinePayReservation` Cloud Function，`functions/src/index.js`），購物車每個品項×數量展開成對應筆數的真實 `locks` 草稿（一份餐點一組取餐碼，沿用 `HomePage.tsx`「預約加入計畫」已經用過的「一次寫入 N 筆」模式），付款確認後才真的建立 `locks`。`confirmLinePayPayment` 因此改成統一處理陣列（`lock_drafts`），單品項（`/lock`）跟購物車多品項共用同一套確認邏輯。**限制**：商品/商家目錄仍是 mock（`vendor-1`／`vendor-2`／`vendor-3`），不管購物車品項來自哪個假商家，結帳出來的 `locks` 一律掛在唯一的真實商家 `cafe-renheya-demo` 底下（品項名稱/價格是真的，商家歸屬是簡化）——這是選項 (a) 的已知取捨，不是 bug。已實測 Request API 成功導向 LINE Pay Sandbox 結帳頁

**兩套平行資料模型最終決定：選項 (b)，「商品瀏覽」整套併進真正的 Vendor 模型**——`VendorListPage.tsx`／`VendorPage.tsx`／`MenuItemPage.tsx`／`CartPage.tsx`／`VendorPortalMenu.tsx` 五個頁面全部改讀寫真實 `vendors`＋新的 `menu_items` collection（新增 `firestore.rules` 規則，重用既有 `isVendorOwner()`），不再讀 mock 目錄；`createCartLinePayReservation`／`createLinePayReservation` 也拿掉寫死的 `CART_VENDOR_ID`，改吃每個 item 附帶的真實 `vendor_id`（並驗證該 vendor 真的存在）——購物車/單點鎖定終於會正確歸戶到下單的那家商家，不再全部掛在 `cafe-renheya-demo` 底下。同時：
- **揪團預購場次／現場點餐維持 mock，暫不刪**：盤點後發現這功能從頭到尾是斷頭的——消費者端完全沒有「加入場次/下團購單」的入口，連 mock UI 都沒做過，商家後台永遠只會看到自己手動輸入的現場訂單。曾經一度整組刪掉（`VendorPortalSessions/Orders/Scan/Dashboard/Reports.tsx` + `VendorPortalSessionSummary.tsx`，連同路由/導覽列），後來決定先復原、保留商家後台完整 9 項導覽（總覽／訂餐時段／核對取餐／菜單管理／訂單管理／今日備料／統計報表／成長獎勵／店家設定）。**待決定，先記錄不做**：(a) 維持現狀，這幾頁只是示意用，資料仍是假的；(b) 只把商家後台那半邊（`order_sessions`/`pre_orders`/`table_orders` collection＋商家自建現場訂單/管理場次/核對取餐/報表統計）換成真的 Firestore，消費者端依然沒有入口，商家後台平常還是空的；(c) 連消費者端「加入場次/下團購單」的畫面也一起從零設計並開發（目前連 mock UI 都沒有），規模最大，才能讓整套功能真正被使用
- **解封申訴只做管理員後台那半邊**：新增真實 `ban_appeals` collection（`firestore.rules` 限 `isAdmin()` 讀寫），`AdminAppealsPage.tsx` 改真實讀取/核准/拒絕，並補上 `RequireRealAdmin`（原本用假登入的 admin 角色判斷，寫入本來就會被規則擋下）。**消費者端「提交解封申訴」仍然完全沒有入口**（連 mock UI 都沒有，登入頁條款裡的「會員中心提交申訴」只是宣傳文字，沒有對應功能）——要做消費者自助申訴，得先有真實使用者帳號體系（手機門號 OTP 登入，見上方「會員／身分驗證」項目）落地，因為現在消費者端都是匿名 Firebase Auth，裝置一換 uid 就變，沒有穩定身分可以綁定封禁狀態。這次刻意只做管理員能看到的那一半
- **HomePage.tsx 的「合作店家與計畫」「同學轉讓保底專區」「今日推薦鎖定方案」卡片全部換成真的**：新增 `meal_plans` collection（每個商家 A/B 兩方案，價格照該商家 `menu_items` 已有單品價打折算，不是憑空數字）；轉讓預覽改真的查 `locks`（`status=='for_resale'`），拿掉平台本來就不追蹤的虛構「原價/轉讓價」跟賣家姓名；「今日推薦鎖定方案」原本 `handleToggleLock` 連 Firestore 都沒碰、純前端示意，現在真的呼叫 `createLinePayReservation` 導向 LINE Pay，折扣依 `pickupDate` 用 `web/src/lib/pricing.ts` 的早鳥階梯現算，認證商家／履約穩定度徽章也改讀真實 `vendor.verified`／`reliability_tone`
- `web/src/lib/mockData.ts` 大部分清空，只留「商家訂閱平台」這條仍未接後端的線在用的 `mockVendors`／`mockGetMyVendor`／`mockUpdateVendor`／`mockSaveVendorSettings`／`mockRequestCancelSubscription`／`mockReactivateSubscription`／`mockApproveVendor`（`VendorPortalSettings.tsx`／`VendorPortalLayout.tsx`／`admin/AdminVendorsPage.tsx` 還在用，這次沒動——真實後端沒有「商家訂閱平台」這個概念，屬於更大的、還沒排進來的範圍）

**部署待辦**（改了 `firestore.rules` 新增 `menu_items`／`meal_plans`／`ban_appeals` 規則，也改了 `functions/src/index.js` 的 `createCartLinePayReservation`／`createLinePayReservation`）：
- [ ] `firebase deploy --only firestore:rules`
- [ ] `firebase deploy --only functions`
- [ ] 部署後實測一次購物車結帳，Firestore Console 確認新產生的 `locks.vendor_id` 正確對應下單的商家（不是全部變成 `cafe-renheya-demo`）

**🟡 ISO27001（系統與安全）**：2026-09-21 完成技術面落差分析＋修補，詳見 [ISO27001_落差分析.md](ISO27001_落差分析.md)。已補：Functions 授權（管理員／商家 owner）、`payouts`／`accuracy_reports` 限管理員與該商家 owner 可讀（`vendors/{id}.owner_uid` 綁定，商家儀表板改為需登入）、FCM token 私有化、`locks` 完整性規則、管理員稽核日誌、Hosting 安全標頭。`firestore.rules` 與前端已於 2026-09-21 部署上線（規則以未登入 REST 請求驗證過：敏感集合回 403）。**待辦**：下方煙霧測試；錄 demo 前照文件「商家帳號綁定」流程建商家帳號並設 `owner_uid`（否則商家儀表板看不到資料）；認證所需的 ISMS 管理制度文件尚未建立

**ISO27001 上線後煙霧測試（2026-09-21 以 Chrome 擴充功能實測）**
- [V] 開 https://bunnbaa-mvp-5474.web.app/#/lock，按「鎖定這份」，看到取餐 QR code 即成功（通過，測試單 `9MNIFR3H`）
- [V] `/#/login` 用 `admin@test.com`（密碼任意）登入平台 → 開 `/#/admin/locks` → 用真實管理員帳號（`suw192336@gmail.com`）登入 → 對一筆訂單按「標記已完成取餐」再「退回鎖定中」還原（通過，兩次狀態切換皆成功、Console 無錯誤）
- [ ] Firestore Console 確認 `admin_audit_logs` 多了兩筆（含 admin_email 與狀態變化）——**尚未親眼確認**：程式為單一 `writeBatch`（狀態更新與稽核紀錄同成敗），兩次切換都成功，理論上兩筆都已寫入，但需在 Console 看過才算數
- [V] 瀏覽器 F12 Console 檢查有無 `Content-Security-Policy-Report-Only` 違規（通過：重新載入後無 CSP 違規、無 error；唯一警告是 `VAPID_KEY not set`，屬預期，見上方 FCM 卡點）
- [ ] 長期觀察無 CSP 違規後，把 `firebase.json` 的 `Content-Security-Policy-Report-Only` 改為 `Content-Security-Policy`（目前只測過 `/lock` 與兩個 mock 管理頁，尚未涵蓋所有頁面）
- [ ] Console 手動項目：帳號 2FA、Firebase API key 加 referrer 限制（`bunnbaa-mvp-5474.web.app/*`、`bunnbaa-mvp-5474.firebaseapp.com/*`、`localhost:*`，存檔後立刻重測正式站）、Cloud Audit Logs 開資料讀寫、GitHub `master` branch protection（需先與雅婷討論改走 PR）

---

## UI 草圖對照（設計稿 vs 現有頁面）

UI 草圖：https://claude.ai/artifact/WyPDxzfSrUG2ZA4M3EDrJc （僅參考版面骨架與資訊架構，配色/字體不採用，其他 UI 依照原模型）

導覽骨架：草圖三頁（Main/Marketplace/MyBookings）共用同一組 3 項主導覽「預購鎖定／轉讓市集／我的商品」。`PlanSchedule.dc.html` 已被合併進 `Main.dc.html`，不當獨立頁面處理。

設計系統：http://localhost:5199/#/design-system

### 逐頁狀態

| 草圖頁 | 現有對應 | 狀態 |
|---|---|---|
| `PlanSchedule.dc.html`（合作店家與計畫） | `HomePage.tsx` | ✅ 已一比一做出來 |
| `Main.dc.html`「預購鎖定」 | 2026-09-21 補進 `HomePage.tsx` | 🟡 版面＋互動骨架完成，**尚未接後端**——真正端到端接 Firestore 的示範仍在 `/lock`（`ConsumerLockPage.tsx`），兩邊還沒合併 |
| `Marketplace.dc.html`「轉讓市集」 | `TransferMarketPage.tsx`（`/marketplace`） | 🟡 2026-09-22 接上真實 Firestore：瀏覽轉讓／我要接手（`claimResoldLock`）／免費領取／我的轉讓皆已是真實查詢與寫入。**尚未接後端**：「取消轉讓」（firestore.rules 沒有對應規則讓 owner 把 `for_resale` 改回 `locked`）；已被接手的項目也無法在「我的轉讓」追蹤（資料模型沒記錄原轉讓者） |
| `MyBookings.dc.html`「我的商品」 | `MyBookingsPage.tsx`（`/my-bookings`） | 🟡 2026-09-22 改接真實 Firestore：依 `buyer_uid` 查真實 `locks`；「使用」（顯示取餐碼）／「贈送」（`for_gift`）／「交易」（`for_resale`）／「留下回饋」都是真的讀寫。2026-09-23 把版面改回草圖原本的週曆格狀（一開始改接 Firestore 時因為真實筆數不固定，暫時退回成依 `pickup_date` 分組的直條清單——這次恢復週曆，但格數改成資料驅動：預設顯示當週往後 3 週，若有訂單落在範圍外會整週延伸，不會像原本假資料那樣固定 21 格裝不下；格子裡放精簡的訂單小卡，點下去在下方展開完整操作區塊（QR／贈送／交易／回饋）。**尚未接後端**：核銷仍要靠商家端 `markLockOutcome`（消費者這邊只能顯示取餐碼，不能自己按完成）；「計畫型」（訂閱制多日方案）完全沒有真實資料模型，這次沒有補假資料 |
| `Login.dc.html`（手機門號 OTP 兩段式） | `LoginPage.tsx`（`mockAuth.ts` 帳號字串猜角色） | 🟡 草圖確認要 OTP 流程，尚未做 |
| `VendorDashboard.dc.html`（商家後台：訂單/備料/收益/成長獎勵） | 既有 `VendorPortalLayout.tsx` 系列 + 新增備料/成長獎勵頁 | 🟡 見下方「全新機制」 |

### 草圖裡後端還接不上的功能（待辦清單）

- [V] 逾時自動開放 $0 元領取（Marketplace）——2026-09-22 完成：沿用既有 firestore.rules 的 lazy expiry 規則（不用排程 Function），`TransferMarketPage.tsx` 已接上真實 `locks` 查詢＋`claimResoldLock`／免費領取
- [V] 取消轉讓（Marketplace「我的轉讓」／MyBookings）——2026-09-22 完成：`firestore.rules` 補上規則讓 owner 把還沒被接手的 `for_resale`／`for_gift` 改回 `locked`，兩頁都接了真的「取消轉讓／取消贈送」按鈕。**待辦**：這條規則要人工執行 `firebase deploy --only firestore:rules` 才會在正式站生效
- [V] 贈送給指定朋友（MyBookings「贈送」）——2026-09-22 完成：改成真實 `for_gift` 機制（同 `ConsumerLockPage.tsx` 的 `handleGift`），沒有「指名」欄位——生成連結後私下傳給朋友，跟 QR 取餐碼「給誰就是誰的」同一套信任模型
- [V] 留下回饋／評論（MyBookings 過去餐點）——2026-09-22 完成：`MyBookingsPage.tsx` 整頁改接真實 `locks`（依 `buyer_uid` 查詢，`pickup_date` 分組成清單，不是原本假資料的固定週曆格），「留下回饋」沿用 `Lock.consumer_feedback`，跟「使用」「贈送」「交易」一起接上真實 Firestore。「計畫型」（訂閱制）沒有真實資料模型，這次沒補假資料，只顯示單點型真實紀錄
- [V] 計畫型（訂閱制多日方案）——2026-09-22 完成，但用了跟原設想不同的簡化設計：沒有另外的 `plan`/`subscription` collection，「預約加入計畫」當下直接一次寫入 N 筆真實 `locks`（同一個 `plan_id` 串起來，見 `types.ts` 的 `Lock.plan_id`/`plan_label`），不用排程 Cloud Function 每天生一筆——原因是這樣就不受 Blaze 卡住。取餐日從明天起算連續 N 天，沒有對應「下週一/二/三」那組展示用文字實際換算日期
- [V] 認證商家徽章——2026-09-22 完成，`Vendor.verified` 欄位（只有 admin 能寫，`firestore.rules` 的 `vendors` 寫入規則本來就沒限制欄位白名單，不用改規則），`AdminSettingsPage.tsx` 新增「認證商家」卡片可以勾選，`ConsumerLockPage.tsx` 顯示徽章
- [V] 早鳥階梯定價 95/8/7 折——2026-09-22 完成，`web/src/lib/pricing.ts`（純函式，可測），已接進 `ConsumerLockPage.tsx` 的 `handleLock()`。`HomePage.tsx` 的 `mockLockMeals` 卡片是純前端 mock、還沒接真實下單流程，沒有一併套用
- [V] `growth_rewards`／`draws` collection 重新設計——2026-09-22 完成資料模型 + 規則設計，抽獎邏輯（`drawGrowthReward`）寫在 `functions/src/index.js`，機率權重制、0 元券見底自動降級 1 折保底，符合「機率計算不能信任 client」的要求。`VendorPortalGrowth.tsx`／`GrowthRewardTicker.tsx`／`HomePage.tsx`（新增消費者端「成長獎勵抽獎」卡片）都接上真實資料。2026-09-23 `drawGrowthReward` Function 與 `growth_rewards`／`draws` 規則已部署上正式站。**待辦**：還沒真的在正式站被呼叫過測試
- [V] 備料聚合改成依 `locks` collection 的 `pickup_date` + `pickup_window` 即時分組——2026-09-22 完成，`VendorPortalPrep.tsx` 改用 `onSnapshot`

QR 核銷碼（MyBookings「使用」面板）已有對應實作可沿用：`LockQRCode.tsx` + `VendorRedeemPage.tsx`。

**建議順序**：`Marketplace.dc.html`（`claimResoldLock` 後端已存在）→ `MyBookings.dc.html`（互動最重、最依賴目前還不存在的資料模型）。

---

## 環境搭建剩餘步驟（Donna——對應「Donna 負責」的「Firebase 專案建置」）

- [V] Firebase 專案建立
- [V] `firebase use --add` 連結專案，產生 `.firebaserc`
- [V] 啟用 Firestore（asia-east1）、Authentication（匿名登入）
- [V] 部署 `firestore.rules` 和 `firestore.indexes.json`
- [V] 2026-09-23 升級到 Blaze 方案 → 啟用 Functions → 部署 10/11 個 Cloud Functions（`onLockCreated` 因 Eventarc 權限生效延遲，重試部署中）
- [V] 啟用 Hosting：`web/` 已 build 並部署，https://bunnbaa-mvp-5474.web.app （正式環境 Firestore 是空的，還沒 seed demo 資料；等要錄 demo 前再灌資料）
- [ ] 申請 Gemini API Key（見上方卡點 2），填入 `functions/.env`
- [V] 把 `web/src/lib/firebase.ts` 的 `firebaseConfig` 換成真實專案設定值
- [V] 本機用 emulator 跑通：消費者端「鎖定這份」流程已驗證（匿名登入、Firestore 寫入、`onLockCreated` 觸發都正常，只差 Gemini Key 導致折扣說明卡在「產生說明中」）

已完成：`functions/` 和 `web/` 的 npm 依賴都裝好，四個 Cloud Functions 檔案語法確認正常，`web` 補了缺失的 `vite-env.d.ts`，`npx tsc --noEmit` 已過。

---

## 骨架裡尚未實作的功能（見 `README.md`「尚未實作」清單）

- [V] 轉賣流程實際 UI（`claimResoldLock`，emulator 端到端測過，含兩個匿名帳號互相接手）（Donna）
- [V] 履約穩定度徽章自動換算（`runCalibrationForVendor` 算完 accuracy_rate 自動更新 `reliability_tone`）——**還沒端到端測過**，需 Gemini Key 才能真的跑出報告（Donna）
- [V] 取餐時段推播提醒（spec §3.7，FCM，跟 AI 無關的純 UX）——2026-09-20 已完成程式碼，跟「Donna 負責」清單裡的「取餐提醒推播(FCM)」是同一件事，這裡的 `[ ]` 是沒同步更新的舊紀錄。程式碼由 **SU** 完成（`web/src/lib/messaging.ts` + `functions/src/index.js` 的 `pickupReminders`），部署卡 Blaze／VAPID key 歸 **Donna**
- [V] 商家後台標記 no-show／備註介面（`/vendor/redeem`，`VendorRedeemPage.tsx`，emulator 已驗證）（Donna）

## 之後的工作（照架構文件時程表順序，Donna——內容跟「Donna 負責」清單重複，保留當時程時間軸參考）

- [V] 從 `BunnBaa Parse_Ref` 複製可沿用的前端元件（QR 核銷、react-hook-form+zod 表單、Cloudinary 上傳元件已搬過來但還沒接到任何頁面）
- [V] 商業邏輯用「參照不複製」原則檢視完成
- [V] 金流串接（假資料版）：`settleVendorPayouts`（全額撥款商家，無平台抽成，daily schedule + 手動觸發，emulator 端到端測過含重複點擊防護）；轉賣金流不經過平台（買家對買家私下付款，平台只轉移 `buyer_uid`）
- [ ] 整合測試 → 部署 Firebase Hosting → 錄 Demo（3 分鐘腳本見 v6 §8）→ 撰寫英文版 Proposal → **10/18 前提交**（Hosting 還沒重新部署最新的轉賣/撥款功能；對應「Donna 負責」⬜ 清單的「整合測試」「Demo 錄製＋Proposal」）

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



