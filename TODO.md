# BunnBaa 開發 TODO

對應文件：`BunnBaa_0到1架構文件.docx`（唯一權威文件）、`BunnBaa_技術規格文件_v6_消費者端補強版.docx`（兩份都在 repo 根目錄）、`BunnBaa_現有雛型改造指南.docx`（目前在本機找不到）。舊雛型參照：`../BunnBaa Parse_Ref/`。架構與開發設定見 [README.md](README.md)。

**截止日：10/18 前提交 Demo ＋ 英文版 Proposal。**

狀態圖例：✅ 已完成／🟡 程式碼完成但未在正式站驗證／🔴 卡住（等人工或外部審核）／⬜ 未開始

---

## 🔴 待辦總表（依優先順序）

### 1. 外部卡點（人工處理，歸 Donna）

- [V] **Gemini API Key**——2026-09-24 完成，本機實測兩個 Agent 都能產出。注意：`bunnbaa-mvp-5474` 因為 Blaze 綁了帳單，會自動變成付費層（Prepay，餘額 $0 → 402），所以 key 是從**另一個沒綁帳單的新專案**申請，走免費層。同時把已下架的 `gemini-2.0-flash` 換成 `gemini-3.6-flash`，並對 503／429 加上重試（`functions/src/gemini.js`）。2026-09-25 已部署 functions，正式站驗證見 §3「商家校準報告」
- [-] **LINE Pay／綠界特約商店審核**（2026-09-24 決定：Demo 沿用 Sandbox，暫不送審）——Sandbox 已全部跑通。之後要正式上線再送審（可能要數週），審核過後把 `functions/.env` 換成正式 Channel ID/Secret＋`LINE_PAY_ENV=production` 即可，程式碼不用改
- [V] **VAPID key**——2026-09-24 已填入，2026-09-25 已部署 hosting，推播實測見 §3「取餐提醒推播」。（`web/src/lib/messaging.ts` 的 `VAPID_KEY`）

### 2. 部署（2026-09-25 已全部部署：規則＋索引、Functions、hosting）

`firestore.rules` 新增 `menu_items`／`meal_plans`／`ban_appeals` 規則，`functions/src/index.js` 改了 `createCartLinePayReservation`／`createLinePayReservation`（改吃每個品項的真實 `vendor_id`）：
- [V] `firebase deploy --only firestore:rules,firestore:indexes`（2026-09-24 再次更新：`locks` 改成只有轉賣中／贈送中公開讀，新增 `vendor_id+status+created_at` 複合索引——**索引要先建好**，不然轉讓市集查詢會失敗；2026-09-24 又新增 `users`／`vendor_applications` 規則，平台登入改真實 Firebase Auth 後註冊、廠商申請都要靠這兩條）
- [V] `firebase deploy --only functions`（2026-09-24 起消費端 callable 會擋匿名身分，前端已不再匿名登入，**規則、Functions、hosting 要一起部署**，不然舊版前端的匿名使用者會全部被擋）
- [V] `cd web && npm run build` 後 `firebase deploy --only hosting`（設計系統／新 design tokens 也還沒上線）
- [ ] **部署 hosting（QR 相機掃碼）**：2026-09-28 改了 `firebase.json` 的 `Permissions-Policy`（`camera=(self)`）＋新增 `QrScannerDialog.tsx`／`jsqr` 依賴，`cd web && npm run build` 後 `firebase deploy --only hosting`。只動前端和 hosting 標頭，不用部署規則／Functions
- [ ] **Functions runtime 升級**：部署時警告 Node.js 20 於 **2026-10-30 停用**，之後無法再部署 Functions。10/18 Demo 不受影響，比賽後要繼續改 Functions 前，先把 `functions/package.json` 的 engines 升到 Node 22＋`firebase-functions@latest`（有 breaking changes，要重測）
- [ ] 部署後實測一次購物車結帳，到 Firestore Console 確認新的 `locks.vendor_id` 對應下單的商家，不是全部掛在 `cafe-renheya-demo`（2026-09-25 單品項 `/lock` 下單仁和雅咖啡已確認 `vendor_id` 正確；還要用**別家**商家的品項走一次購物車才算驗完）

### 3. 正式站驗證（已部署，但還沒在正式站實際跑過）

- [ ] QR Code 核銷（2026-09-25 正式站已驗證步驟 1、2、3、「重複核銷被擋」與取餐編號夾空白（輸入 `ejel 6pro` 自動變 `EJEL6PRO` 查得到）：取餐編號 `XVTVDHP0` 由仁和雅咖啡店主帳號核銷成功；2026-09-28 又驗證步驟 4「登記未取餐」（`KFAHATZZ`、`8HVO4YHO` → `no_show`＋備註）與一般會員的 `permission-denied`（開頁面被導回首頁、直接呼叫回 403）；**只剩**別家商家帳號的 `permission-denied`（要等第二家商家綁店主才能測）＋2026-09-28 新增的相機掃碼手機實測，兩者各自拆成下面獨立項目）：`markLockOutcome`／`VendorRedeemPage.tsx`（emulator 已驗證，但 **emulator 下 `assertAdminOrVendorOwner` 直接放行，權限這段只有正式站測得到**）。前置：§2 部署完＋§4 商家帳號綁定。步驟：
  1. 一般會員帳號鎖定一筆仁和雅咖啡的餐（LINE Pay Sandbox 付款）→ `/my-bookings`「使用」記下取餐編號末 8 碼
  2. 商家帳號登入 `/lock/vendor/redeem`：取餐總覽要看得到這筆（驗證 `locks` 讀取規則＋`vendor_id+created_at` 索引），輸入末 8 碼查得到
  3. 按「確認取餐」→ Firestore Console 看 `locks/{id}.status` 變 `fulfilled`
  4. 再鎖一筆，改按「登記未取餐」填備註 → `status=no_show`＋`no_show_note`
  5. 負面測試：已核銷的同一碼再查一次要被擋；用**別家**商家帳號或一般會員呼叫要回 `permission-denied`
  - 2026-09-28：商家端補上**相機掃碼**（`QrScannerDialog.tsx`，用 `jsqr` 解，iOS Safari 也能用）：「用相機掃描 QR Code」→ 解出 `{lockId, vendorId}` → 用 lockId **直接讀那筆 lock**，以 Firestore 裡真正的 `vendor_id` 判斷是不是本店（讀不到或不同店就擋），不看 QR 裡的 vendorId、也不受末 8 碼查詢「最近 200 筆」的限制；同時修 `PaymentConfirmPage.tsx` 付款成功頁的 QR 原本 `vendorId` 寫死 `cafe-renheya-demo`（購物車跨店結帳時別家的 QR 也標成仁和雅），改成讀每筆 lock 的真實 `vendor_id`；手動輸入末 8 碼保留當備援。`firebase.json` 的 `Permissions-Policy` 從 `camera=()` 改成 `camera=(self)`，**不改的話正式站相機會被瀏覽器直接擋掉**。實測見下方「QR 相機掃碼」
  - 2026-09-25：`markLockOutcome` 補上伺服器端狀態檢查（只有 `locked`／`for_resale` 可核銷，用 transaction 防兩台裝置重複核銷），原本直接呼叫可以把已完成／已結算的鎖定改成 `no_show`。要跟 §2 的 functions 一起部署
- [ ] 撥款排程：`settleVendorPayouts`＋手動觸發（emulator 已驗證重複點擊不會重複結算）
- [ ] 成長獎勵抽獎：`drawGrowthReward`（2026-09-24 修：消費者首頁原本讀 `payouts` 判斷是否解鎖，但 `payouts` 只限管理員／店主讀，消費者永遠看不到抽獎。改成讀公開的 `growth_rewards.unlocked_milestones`，由撥款結算的 `syncGrowthUnlock` 寫入、只有門檻 id 不含金額。**部署 Functions 後要跑一次** `triggerSettlementNow`（或等當天 20:00 排程）把正式站的解鎖狀態補上，不然首頁還是顯示未解鎖）
- [ ] 我的鎖定頁：`MyLocksPage.tsx`（`/my-locks`）
- [ ] 取餐提醒推播：`pickupReminders`／`triggerPickupRemindersNow`
- [ ] 商家校準報告＋what-if 追問：`dailyCalibration`／`askCalibrationScenario`，以及 `reliability_tone` 自動換算
- [ ] 到 Firestore Console 確認 `admin_audit_logs` 有 2026-09-21 煙霧測試產生的兩筆（含 `admin_email` 與狀態變化）
- [ ] **別家商家帳號呼叫 `markLockOutcome` 要回 `permission-denied`**（QR 核銷步驟 5 最後一項）：正式站目前只有仁和雅綁了店主。等第二家商家綁定後，用那家店主帳號開 `/lock/vendor/redeem` 查仁和雅的取餐編號，或直接呼叫 `markLockOutcome`。為避免擋不住時改到真實資料，挑一筆已經 `fulfilled` 的仁和雅鎖定來打（例：`F1S63VpLVZqDxVTvdHp0`／`XVTVDHP0`）：權限檢查排在狀態檢查之前，擋得住回 403，擋不住只會回 `failed-precondition` 不寫入。**注意：這項不能用相機掃碼測**——掃到別家店的碼前端就先擋掉，不會呼叫到 `markLockOutcome`，要用手動輸入末 8 碼或直接呼叫
- [ ] **QR 相機掃碼**（2026-09-28 新增 `QrScannerDialog.tsx`，目前只過了 `tsc`＋`vite build`）：§2 部署 hosting 後用手機實測。前置：正式站是 HTTPS（相機必要條件）。步驟：
  1. 消費者手機開 `/my-bookings` →「使用」顯示 QR
  2. 仁和雅店主用**另一支手機**開 `/lock/vendor/redeem` →「用相機掃描 QR Code」，第一次要跳相機權限詢問，允許後看得到畫面（iPhone Safari＋Android Chrome 各試一次）
  3. 對準 QR → 視窗自動關閉、下方跳出該筆的核對結果卡，取餐編號欄自動帶入末 8 碼 → 按「確認取餐」成功。付款成功頁（`/payment/confirm/...`）上的 QR 也掃一次，確認同樣查得到
  4. 負面：再掃同一張 → 顯示「已經是『已完成取餐』狀態」；掃一張桌位點餐 QR（`VendorPortalSettings` 下載的）→ 顯示「這不是 BunnBaa 的取餐 QR Code」；拒絕相機權限 → 顯示改用手動輸入的提示
- [ ] **「加入計畫」被封鎖時的白話提示**（§6 解封申訴，2026-09-28 改的 `HomePage.tsx`）：推 master 部署後，封鎖一個測試會員再按「預約加入計畫」，要看到「您的帳號因多次未取餐已被限制下單，請至會員中心提交解封申訴」，不是 `Missing or insufficient permissions.`。（同日「加入計畫」已改走伺服器，前端直接擋 `isOrderBanned`，登入期間才被封鎖的由 `createPlanLinePayReservation` 回同一句白話）
- [ ] **「加入計畫」走 LINE Pay**（§6，2026-09-28 改走伺服器，emulator 已測 Function，瀏覽器還沒點過）：部署後，一般會員按「預約加入計畫」→ 確認視窗選第一天＋時段，預覽的取餐日要跳過公休日 → 勾聲明 → LINE Pay Sandbox 付款 → 付款成功頁出現 N 張 QR → `/my-bookings` 看到 N 筆、`plan_id` 相同。負面：商家設份數上限後把某天訂滿，加入計畫要被擋並說是哪一天額滿
- [ ] **清除正式站測試資料**：2026-09-28 解封流程測試在 `customer@bunnbaa.test` 名下留了「A方案：五日輕食計畫」5 筆 locks（`3FISlB1jhR7o8hVo4YHo`、`4XYmoY4zyhT1kFaHATzz`、`JBeV9Xc7C58da8YF09xv`、`GtAMfgcFRBymMQ2cdjXh`、`jNnDK42dOdMF75jckhWe`）＋一筆已核准的 `ban_appeals/lI5dGTVtIBfByBIUTy3W`，到 Firestore Console 刪除（前兩筆是 no_show，會被商家校準報告算進去）。另外 9/25 份數測試的 `EJEL6PRO` 掛在仁和雅店主帳號名下（見 §6），也可以一起刪

### 4. Demo 準備（整合與交付）

- [V] 正式站灌 demo 資料（`scripts/seed.js`）——2026-09-24 確認雲端已有資料（seed.js 回報 locks already exist），不需再灌
- [V] **正式站商家帳號綁定**——2026-09-25 仁和雅咖啡已綁定店主帳號（廠商申請 → `/admin/vendors` 核准）。同日新增第二個管理員 `ckchildlikekid@gmail.com`（`firestore.rules`／`functions/src/index.js`／`web/src/lib/adminAuth.ts` 三處白名單，ISMS 角色表已更新），因為 `suw192336@gmail.com` 的正式站密碼只有 SU 知道。王媽媽便當／阿嘉炸雞排／早安三明治仍沒有店主帳號，要 Demo 多家店再照同流程綁
- [ ] 整合測試（端到端跑過消費者、商家、管理員三條線）
- [ ] 錄 Demo（3 分鐘腳本見 v6 §8）
- [ ] 撰寫英文版 Proposal

### 5. ISO27001 剩餘項目（詳見 [ISO27001_落差分析.md](ISO27001_落差分析.md)）

- [ ] 長期觀察沒有 CSP 違規後，把 `firebase.json` 的 `Content-Security-Policy-Report-Only` 改成 `Content-Security-Policy`（目前只測過 `/lock` 跟兩個管理頁）
- [V] SU 自己的 Google／GitHub 帳號 2FA——2026-09-25 完成（理由見 ISO27001 文件「情境重新評估」：這是參賽用原型不是正式上線，但比賽規則要求公開 repo＋公開網址，評審期間客觀上是曝露的，值得做）
- [V] Firebase API key 加 referrer 限制——2026-09-25 完成並驗證：已加三筆（`bunnbaa-mvp-5474.web.app/*`、`bunnbaa-mvp-5474.firebaseapp.com/*`、`localhost:*`）。用 `curl` 帶假 Referer 直接打 Firebase Auth 初始化 API 測過：正確網域回 200，不相干網域（`evil.example.com`）與完全不帶 Referer 都回 403 `API_KEY_HTTP_REFERRER_BLOCKED`，正式站本身仍正常載入（HTTP 200）
- [-] ~~Cloud Audit Logs 開資料讀寫~~——2026-09-25 決定暫緩：只有事後鑑識用途（查誰讀寫過什麼），不會擋下任何事，對三週衝刺的參賽專案報酬率低，等要往正式商轉再開
- [ ] **待跟雅婷討論，不預設要做**：`ckchildlikekid@gmail.com` 開 2FA；GitHub `master` branch protection（會改變目前直接推 master 自動部署的流程，衝刺截止日前可能得不償失，見 ISO27001 文件）
- [V] 建立認證所需的 ISMS 管理制度文件——2026-09-25 完成 v1：[ISMS_管理制度文件.md](ISMS_管理制度文件.md)（資安政策、角色職責、風險評鑑與登錄表、適用性聲明 SoA、事件應變程序、備份與 BCP 現況、供應商清單、人員安全、文件審查）。這是符合兩人團隊試營運規模的精簡版，不是拿去給認證機構稽核用的完整版；風險登錄表列了 9 項風險，其中 R1/R4/R5/R7 對應到還沒做的待辦（2FA、branch protection、Firestore 備份、Secret Manager）

### 6. 尚未實作的功能

- [V] **手機門號 OTP 登入**（`LoginPage.tsx`，草圖 `Login.dc.html` 兩段式流程）——2026-09-25 完成：登入分頁新增「改用手機門號登入」，輸入號碼→`sendOtp()`送簡訊驗證碼→輸入驗證碼→`confirmOtp()`登入（`web/src/lib/auth.ts`，用 Firebase Phone Auth + 隱形 reCAPTCHA）。沒有 email 時 `resolveProfile()` 改用門號當 username／displayName，角色判斷不受影響（管理員＝email 白名單，門號登入者一律是會員或已綁定的廠商）。順便修正 CSP：加放 `www.google.com`／`recaptcha.net` 的 script／frame，不然 reCAPTCHA 之後會被擋（`firebase.json`）。2026-09-25 已在 Console 啟用「電話號碼」登入並部署。**還沒驗證**：要在正式站用真手機號碼實際收一次簡訊登入（本機/emulator 的 reCAPTCHA 常會失敗，不建議在本機測）
- [V] 2026-09-24 決定**不再使用匿名登入**：瀏覽不用登入，但鎖定／下單／購物車結帳／轉讓接手／抽獎都要先登入（前端 `useRequireLogin`、`firestore.rules` `isSignedInUser()`、Functions `assertSignedInUser()` 三層都擋）。舊的匿名帳號跟它們名下的鎖定紀錄**不搬移、不保留**
- [V] 到 Firebase Console → Authentication → Sign-in method 把「匿名」停用——2026-09-25 完成
- [V] **從商家點餐沒有取餐日期／時段**——2026-09-25 完成並部署、正式站驗證通過：購物車結帳前選日期＋時段（`components/PickupPicker.tsx`，今天已開始的時段不能選、最遠 30 天），列出訂單明細（商家、地點、時間、早鳥價、備註、總計），商品備註改成真的寫進 `locks.note` 並顯示在商家核對取餐頁。同時段已有「已鎖定」訂單只**提醒不擋**（`hooks/useSlotConflicts.ts`，首頁也有）。**價格改由伺服器從 `menu_items` 重算**（`functions/src/pricing.js`），原本前端送什麼價格就收什麼。`createLinePayReservation`／`createCartLinePayReservation` 參數改了（改送 `menu_item_id`＋`pickup_date`＋`pickup_window`），之後改這兩支 Function 都要跟 hosting 一起部署
- [V] **取餐時段／公休／份數上限由商家後台控制**——2026-09-25 完成並部署：店家設定頁（`VendorPortalSettings.tsx`）的簡介、地址、電話、營業日、公休日改接真實 `vendors/{id}`，新增「取餐時段」與「每個時段份數上限」（`pickup_windows`／`business_hours`／`holidays`／`slot_capacity`；店名仍只有管理員能改）。消費端 `PickupPicker` 照商家設定顯示時段、公休、剩幾份；伺服器結帳照同一套驗證（`functions/src/pricing.js`），份數在 `confirmLinePayPayment` 用 transaction 預扣（`slot_counters`），**先扣份數再向 LINE Pay 確認扣款**，額滿就不扣款。已知限制：① 首頁左側時段選擇是先選、所有店共用預設時段，下單時才檢查該店有沒有開；② 「加入計畫」（多日方案）是前端直接寫 locks，**不受時段／公休／份數限制**；③ 2026-09-25 以前的訂單不計入份數；④ 商家改設定後，消費者要重新整理頁面才看得到（前端快取），伺服器結帳一律照最新設定。
  - 正式站驗證（2026-09-25，仁和雅咖啡店主帳號）：設定頁儲存份數 1＋公休日 10/3 成功且重新載入仍在；購物車公休日顯示「這天是店家公休日」並停用結帳、各時段顯示「剩 1 份」、數量 2 時提示只剩 1 份；實際付款一筆（10/5 11:30–12:00，NT$128＝伺服器算的 8 折，取餐編號 `EJEL6PRO`）後該時段變「已額滿」；份數改回不限後，同時段重複訂購出現提醒但不擋。測試完已把份數改回不限、刪除 10/3 公休日。`EJEL6PRO` 這筆測試訂單掛在店主帳號名下，不需要可到 Firestore Console 刪除
  - **還沒測**：兩人同時搶最後一份（transaction 應只讓一人成功、另一人不扣款）、LINE Pay 確認失敗時份數退回
- [V] **「加入計畫」（多日方案）改走伺服器**——2026-09-28 程式碼完成（未部署）。原本 `HomePage.tsx` 的 `handleJoinPlan` 在前端直接寫 N 筆 locks，固定 `12:00-13:00`、不經付款，也不受商家時段／公休／份數限制
  - 新 callable `createPlanLinePayReservation({ plan_id, start_date, pickup_window })`：價格讀 `meal_plans.price_per_meal`（不再疊早鳥折扣），`functions/src/pricing.js` 的 `planPickupDates` 從開始日起、同一時段、**跳過公休／沒營業的日子**排滿 N 天（30 天內排不滿就擋），`assertSlotsHaveRoom` 檢查每天份數，一次 LINE Pay 付清；付款確認沿用 `confirmLinePayPayment`（份數 transaction、失敗退回都共用）。locks 的 `plan_id` 改成這張訂單 id（每次加入各自一組），舊資料是 `vendor_id-方案 id`
  - 前端：「預約加入計畫」改開確認視窗——選第一天＋時段（`PickupPicker`，含剩餘份數）、預覽每天的取餐日（`web/src/lib/pickupSlots.ts` 的 `planPickupDates`，跟伺服器同規則）、勾消保法聲明 → 前往 LINE Pay
  - `firestore.rules`：`locks` 改成 `allow create: if false`，前端再也不能自己生 lock（之前可以寫未付款的 lock）。封鎖改由 `assertNotBanned` 在伺服器擋
  - 本機 emulator 10 項測試通過：正常加入（公休日被跳過、金額 90×3、`plan_id`／時段正確、LINE Pay Sandbox 回付款網址）、封鎖會員 `permission-denied`、額滿 `resource-exhausted`、開始日是公休日被擋、未登入被擋、前端直接建立 lock 回 403。**還沒在瀏覽器點過確認視窗**，也還沒跑完整付款（要在 LINE Pay Sandbox 頁面按付款）
  - 部署：**Functions → hosting → rules 依序一起上**。先上 rules 的話舊版首頁的「加入計畫」會直接 403；只上 hosting 沒上 Functions 則新視窗會呼叫不到 Function。實測見 §3
- [V] **消費者端提交解封申訴（含實際的封鎖機制）**——2026-09-28 完成，這項原本沒人排進分工表，SU 認領後做成完整版（不只是入口，連「真的會封鎖人」都補上了，理由：光做申訴表單，沒有封鎖機制配合的話永遠不會有真實使用者用到）：
  - `markLockOutcome` 標記 `no_show` 時，在同一個 transaction 裡把 `users/{buyer_uid}.noPickupCount` 加一，累計滿 2 次（對應會員條款「累計超過一次」）自動設 `orderBanned: true`
  - 封鎖後擋兩條路：`createLinePayReservation`／`createCartLinePayReservation` 開頭擋（`assertNotBanned`），`firestore.rules` 的 `locks` create 規則也擋（防 `HomePage.tsx` 的「加入計畫」這條純前端直寫路徑繞過）
  - 會員中心（`/profile`）新增 `BanAppealSection`：只有 `orderBanned` 為 true 才顯示，可填理由送出 `ban_appeals`；已有審核中/已拒絕的申訴會顯示狀態，拒絕時看得到管理員備註
  - `firestore.rules`：`ban_appeals` 改成被封鎖者能建立自己的申訴（原本是 `allow read, write: if isAdmin()`，完全沒有消費者建立的路）；`users/{uid}` 新增 isAdmin() 才能改的 `orderBanned`/`noPickupCount` 欄位，且**自己更新個人資料的規則改用 `diff().affectedKeys()` 而不是整份文件的 `keys()`**——不改的話，任何人只要被封鎖過一次，文件上多了這兩個欄位，從此連自己的顯示名稱都改不了（本機規則測試抓到這個，寫規則時沒想到）
  - `AdminAppealsPage.tsx` 核准時原本只改 `ban_appeals.status`，沒有真的解除封鎖——改成 batch 一起寫 `users/{uid}.orderBanned=false`＋`noPickupCount=0`，並補一筆 `admin_audit_logs`；拒絕時可以填備註（`window.prompt`，跟其他管理員操作一致的做法）
  - 本機 Firestore emulator 寫了 22 項規則測試全數通過（涵蓋封鎖後擋建立訂單、只有被封鎖者能建立申訴、管理員核准會連動解除封鎖、自己不能亂改封鎖欄位等）；也重跑了之前的 43 項舊測試確認沒有牽連壞掉（1 個舊測試失敗是雅婷之前把 `locks` 公開讀取範圍縮小造成的，跟這次改動無關）
  - 2026-09-28 已部署：hosting 由 9/27 推 master 時 GitHub Actions 自動上線；規則＋索引、Functions（14 支）由本機部署
  - 2026-09-28 本機 emulator 端到端 UI 測試通過（種子帳號，前端＋規則＋Functions 都是目前版本）：店主兩次「登記未取餐」→ `noPickupCount=2`／`orderBanned=true` → 會員 `/lock`、購物車結帳（「您的帳號因多次未取餐已被限制下單…」）、「加入計畫」（規則 `PERMISSION_DENIED`）三條路都被擋 → `/profile` 顯示申訴區塊、送出後顯示「審核中」→ 管理員核准 → `orderBanned=false`／`noPickupCount=0`＋`admin_audit_logs` 一筆 → 會員「加入計畫」成功、購物車結帳正常導向 LINE Pay Sandbox
  - 2026-09-28 修：被封鎖時按「加入計畫」原本 toast 顯示原始錯誤 `PERMISSION_DENIED: evaluation error at L108…`。`HomePage.tsx` 的 `handleJoinPlan` 改成先檢查 `useAuth().isOrderBanned`，登入期間才被封鎖（前端狀態還是舊的）時則把 `permission-denied` 換成同一句白話提示。只過了 `tsc`，還沒在瀏覽器重測
  - 2026-09-28 正式站驗證（`customer@bunnbaa.test` ＋仁和雅店主）：會員開 `/lock/vendor/redeem` 被導回首頁、直接呼叫 `markLockOutcome` 回 403 `PERMISSION_DENIED`；店主把會員「加入計畫」產生的兩筆（`KFAHATZZ`、`8HVO4YHO`）登記未取餐成功 → 會員中心出現限制下單 → `/lock`、購物車、「加入計畫」三條路都被擋 → 申訴成功寫入 `ban_appeals`
  - **正式站抓到的 bug**：`/profile` 查「我最近一筆申訴」用 `where(buyer_uid)+orderBy(created_at desc)`，正式站缺複合索引（emulator 不檢查索引所以本機測不到），查詢失敗後畫面當成「沒有申訴」，不會顯示「審核中」，使用者可以一直重複送出。已在 `firestore.indexes.json` 補 `ban_appeals` `buyer_uid+created_at` 索引，2026-09-28 已部署，正式站確認 `/profile` 會顯示「最近一次申訴：審核中」且不能重複送出
  - 2026-09-28 正式站後半段也通過：管理員 `ckchildlikekid@gmail.com` 在 `/admin/appeals` 核准 → `users` 變 `orderBanned=false`／`noPickupCount=0`、`admin_audit_logs` 多一筆 `approve_ban_appeal` → 會員中心限制提示消失、購物車結帳正常導向 LINE Pay Sandbox。**整條流程正式站驗證完成**
  - 剩下要測的已移到 §3 待辦
  - 測試留在正式站的資料：`customer@bunnbaa.test` 名下「A方案：五日輕食計畫」5 筆 locks（`3FISlB1jhR7o8hVo4YHo`、`4XYmoY4zyhT1kFaHATzz` 已是 no_show；`JBeV9Xc7C58da8YF09xv`、`GtAMfgcFRBymMQ2cdjXh`、`jNnDK42dOdMF75jckhWe` 仍是 locked），清除見 §3 待辦
- [V] 「我的轉讓」無法追蹤已被接手的項目 → 2026-09-28 locks 加 `transferred_from_uids`，接手時由 claimResoldLock／firestore.rules 強制寫入（需重新部署 rules，claimResoldLock 等 Blaze）
  - 已知取捨：原持有人可讀整筆 lock（含新持有人的 consumer_feedback／no_show_note），試營運先接受；要收緊就改成獨立 transfer_records collection
  - 舊資料用 `scripts/backfill-transfers.js` 從 payment_intents 補回原付款人（只補得回第一手，非 LINE Pay 建立的 lock 補不回）
- [V] **商家頁（`/vendor/:id`）手機呈現優化**——2026-09-28 完成，參考外部點餐網站的手機版面。品項改依 `menu_items.category` 分組，商家頁上方新增可橫向滑動的分類標籤列（`sticky top-16`，跟站頭疊在一起），點分類會平滑捲動到對應區塊（用 `scrollIntoView`，不是 `<a href="#..">`——整站是 hash router，網址的 `#` 是路由本身，不能拿來當錨點）。純呈現層改動，沒有動到加入購物車／取餐時間選擇等既有邏輯。只有 1 種分類時不顯示標籤列（沒意義）。**還沒在真實手機或瀏覽器裝置模式下看過**，只確認 `tsc`／`build` 過關

### 7. 待決策

- **揪團預購場次／現場點餐**（商家後台的訂餐時段／核對取餐／訂單管理／統計報表等頁目前仍是 mock）：消費者端從來沒有「加入場次／下團購單」的入口。選項：
  - (a) 維持現狀，當示意頁
  - (b) 只把商家後台那半邊（`order_sessions`／`pre_orders`／`table_orders`）接真 Firestore，消費者端仍沒入口
  - (c) 連消費者端畫面一起從零設計開發，規模最大
- ~~**商家訂閱平台**~~ 2026-09-24 已接真 Firestore（`web/src/lib/subscription.ts`）：狀態存在 `vendors/{id}.subscription_*`，到期（`subscription_end_date` 已過）整個廠商後台擋住；商家只能自助「申請取消」「到期前撤回」（`firestore.rules` 限定這兩種轉換）；**沒有訂閱金流**，續約由管理員確認收款後在 `/admin/vendors` 按「續約 30 天」（寫 `admin_audit_logs`）。新核准的商家自動首月免費試用。正式站既有商家沒有訂閱欄位＝「尚未設定」，不擋也不能自助操作，要管理員按一次續約才開始計期。之後要自動扣款再接 LINE Pay 定期付款

### 8. 寫死資料盤點（2026-09-28 盤點，依序處理）

**部署順序**（2026-09-28 已完成 1、3、4：rules、Functions（21 支含 6 支新的翻譯相關）、hosting 從 `Donna` 分支 `2e1a59b` 部署；Functions 部署要加 `FUNCTIONS_DISCOVERY_TIMEOUT=60`，否則 CLI 分析程式碼 10 秒逾時。**第 2、5 步還沒做**）：
1. `firebase deploy --only firestore:rules`（新增 `reviews`／`platform_config`／`landing_events`，`vendors` 店主可寫 `cover_image`，`users` 本人可寫 `lang`）
2. 正式站補設定資料：`node scripts/seed.js --config-only`（只寫 `platform_config/growth`＋`landing_events`，不動其他資料）
3. `firebase deploy --only functions`（成長門檻讀設定、計畫 locks 加 `meal_plan_id`、錯誤訊息依語言、新增自動翻譯觸發器與 `translateAllContent`）——前端呼叫格式有變（多帶 `lang`），**Functions 與 hosting 要一起部署**
4. `cd web && npm run build` 後 `firebase deploy --only hosting`
5. 管理後台 → 系統設定 →「補翻既有資料」
- 驗證：第二家店綁店主後，用那家帳號看商家後台各頁都只看到自己的資料；`/my-bookings` 已取餐的餐點打分 → 首頁計畫評分、Landing 評價出現；同一筆再評一次要被擋

**A. 寫死商家 ID `cafe-renheya-demo`**（資料是真的，但不論誰登入都只看得到仁和雅；第二家店綁店主就會露餡）→ 改讀登入者綁定的 `user.vendorId`。2026-09-28 程式碼完成（`tsc`＋`vite build` 過），**還沒部署、沒在瀏覽器點過**
- [V] 商家後台：`VendorPortalMenu.tsx`（菜單管理，別家店主會改到仁和雅的菜單）、`VendorPortalPrep.tsx`（今日備料）、`VendorPortalGrowth.tsx`（成長獎勵）
- [V] `/lock/vendor`：`VendorDashboard.tsx`（校準報告）改讀綁定商家，管理員沒綁商家時多一個下拉選單挑商家；`/lock/vendor/redeem`：拿掉退回仁和雅
- [V] 消費端：`HomePage.tsx` 抽獎改列出所有已解鎖（`growth_rewards.unlocked_milestones` 含 tier1）的店家，每家各一顆「抽一次」；首頁轉讓區與 `TransferMarketPage.tsx` 改列所有商家（只用 `status` 單一等值查詢，不用新索引），卡片加上店名。三頁共用的商家清單抽成 `hooks/useVendors.ts`
- [V] `ConsumerLockPage.tsx`（`/lock` Demo 頁）：商家、品名、原價 160 寫死，改讀 `menu_items/cafe-renheya-demo-item-1`（這頁本來就是單店 Demo，商家 ID 保留）

**B. 整頁假資料（讀寫 `web/src/lib/mockData.ts`）**
- [V] 總覽 `VendorPortalDashboard.tsx`：改讀真實 `locks`／`menu_items`（今日待取餐／今日已取餐／近期訂單數／菜單數＋今日各取餐時段份數）
- [V] 店家設定 `VendorPortalSettings.tsx`：封面圖改存 `vendors/{id}.cover_image`，商家列表／商家頁會顯示。**`firestore.rules` 有改（店主可寫 `cover_image`，限 https 網址），要部署 rules**
- [V] 舊版掃碼核銷 `/vendor-portal/scan`：刪掉 `VendorPortalScan.tsx`，路由改導向 `/lock/vendor/redeem`
- [V] 統計報表的「校準洞察」卡（寫死準確率＋假的 AI 回答）改讀真實 `accuracy_reports`＋呼叫 `askCalibrationScenario`
- [V] 訂餐時段、時段明細、訂單管理、統計報表圖表：2026-09-28 決定**改用現有 locks 模型**（§7 揪團預購／現場點餐不做），同日完成：
  - 訂單管理：這家店的鎖定清單，分待取餐／已完成／未取餐／全部，可用取餐編號或品名搜尋，直接確認取餐／登記未取餐（共用元件 `components/LockOrderRow.tsx`，走 `markLockOutcome`）
  - 訂餐時段：一週 × 取餐時段格子，顯示份數、待取、剩餘名額（有設份數上限時），公休日灰掉；點格子進時段明細（備料彙總＋每筆訂單）
  - 統計報表：最近 15 天（依取餐日）收入、份數、平均單價、已取餐數、每日收入圖、熱銷 Top 10
  - 四頁共用 `hooks/useVendorLocks.ts`（最近 500 筆）；店家設定的桌位 QR 拿掉；`lib/mockData.ts`、`lib/statusMap.ts` 與 mock 型別整個刪除
- [V] 刪掉 `mockData.ts` 裡已沒人用的 mock（計畫方案、轉讓、單點卡片、解封申訴、總覽、掃碼、菜單、校準報告）

**C. 畫面寫死或假功能**
- [V] `HomePage.tsx` 預約日曆：預設今天起 7 天（最多 31 天），篩選「期間內有開放取餐」的推薦品項與計畫、取餐日在期間內的轉讓；排序改成相關性／最快可取餐／價格低到高／評分高到低（草圖的「距離」沒有位置資料所以拿掉）
- [V] `LandingPage.tsx` 招牌餐點改讀上架中的 `menu_items`，依分類分頁（最多 5 類、每類 4 道），有圖片就顯示圖片
- [V] 新增評分機制 `reviews/{lockId}`（`firestore.rules` 驗證：只有持有人、只限已取餐、一筆只能評一次、公開可讀）：`/my-bookings` 已取餐的餐點可打 1–5 星，心得勾選公開才會寫進去，署名只顯示「系所＋同學」
- [V] `LandingPage.tsx` 同學評價改讀 `reviews`（有公開心得、4 星以上），沒有就整段不顯示
- [V] `LandingPage.tsx` 近期活動改讀 `landing_events`（公開可讀、管理員可寫，目前沒有後台編輯頁，要改內容到 Firestore Console）；「早鳥最高 7 折／最早 30 天」改從 `lib/pricing` 算；頁尾取餐時段改列各店家設定的時段
- [V] `MarketplaceHeader.tsx` 地址選單：改成「臺灣縣市＋鄉鎮市區」（22 縣市／368 鄉鎮市區，`constants/taiwanDistricts.ts`），選擇記在這台裝置（`lib/location.ts`），首頁（品項／計畫／轉讓）、商家列表、轉讓市集依店家地址篩選（台／臺視為相同；沒填地址的店家在選了地區後不會出現）
- [V] `MarketplaceHeader.tsx` 語言選單：2026-09-28 決定做**英文版**，同日完成**消費端**：頂部列「中／EN」切換（手機選單也有），選擇記在這台裝置。做法是 `lib/i18n.ts`，中英字串並排寫在元件裡 `tr("預購餐點", "Pre-order")`；`App.tsx` 用語言當 Router 的 `key`，切換時整頁重新掛載，所以 toast／錯誤訊息／狀態標籤都會一起換。已翻：頂部列、地區選單、Landing（含 `landing_events` 的 `*_en` 欄位）、首頁、商家列表／商家頁／品項頁、購物車、轉讓市集、我的餐點、我的鎖定、登入／註冊（會員與廠商須知另外寫了英文版，`components/TermsNotices.tsx`，改條款要兩邊一起改）、會員中心、付款結果頁、`/lock` Demo 頁、設計系統元件的無障礙標籤；過敏原／飲食標籤照固定對照表翻（`types.ts` `tagEn`）。本機 `vite preview` 實測中英切換正常
  - 順手修：首頁轉讓卡片店名原本寫死「仁和雅咖啡」、早鳥折扣說明欄寫死 95／8／7 折（改讀 `lib/pricing`）、Landing hero 範例票券寫死的滷肉飯（改成第一道真實餐點）；付款取消頁的返回連結從 `/lock` 改成 `/home`
- [V] **英文版補完（2026-09-28）**：商家後台（總覽、訂餐時段／明細、核對取餐＋QR 掃碼、菜單、訂單、備料、報表、成長獎勵、店家設定、`/lock/vendor` 校準報告）與管理後台（廠商、申訴、訂單、撥款、系統設定）全部加上中英切換；日期格式也跟著語言（`lib/i18n.ts` 的 `dateLocale()`）。成長門檻標籤在 `platform_config/growth.milestones[].label_en`
- [V] **Cloud Functions 錯誤訊息依語言回傳**：前端所有 callable 改用 `web/src/lib/callable.ts`（自動在 data 帶 `lang`），Functions 端 `functions/src/i18n.js` 用 AsyncLocalStorage 記住每個請求的語言（同一實例會並行處理多個請求，不能用全域變數），`onCall` 統一包 `withLang`；額滿、公休、封鎖、LINE Pay 失敗等訊息都有英文。**要部署 Functions 才會生效**，沒部署前英文介面遇到伺服器錯誤仍顯示中文
- [V] **資料庫內容英文版（2026-09-28，用 Gemini 自動翻）**：`functions/src/translate.js`＋Firestore 觸發器 `translateVendor`／`translateMenuItem`／`translateMealPlan`，店家（店名、簡介）、菜單（名稱、說明、分類）、計畫方案（標籤、名稱、說明、最快履約）新增或修改時自動寫入 `*_en` 欄位；記下翻譯時的原文 `i18n_src`，原文沒變就不重翻（觸發器寫回英文會再觸發自己，靠這個停下來）。地址不翻（地區篩選和找店都要中文）。下單時訂單帶 `item_name_en`；AI 折扣說明帶 `discount_explanation_en`；校準報告帶 `explanation_en`／`pattern_note_en`；what-if 追問依介面語言回答。前端用 `loc(obj, "name")` 讀（英文介面優先 `*_en`，沒有就中文）。emulator 實測：寫入菜單約 8 秒產生英文、觸發器自我觸發 7ms 結束不重翻、只改價格不重翻
- [V] **取餐提醒推播依語言**：前端把介面語言存進 `users/{uid}.lang`（`firestore.rules` 允許本人寫 `lang`，限 zh／en），`pickupReminders` 依此送中文或英文，英文用 `item_name_en`
- [ ] **部署後要做一次**：管理後台 → 系統設定 →「補翻既有資料」（`translateAllContent`），把功能上線前的店家、菜單、方案、既有訂單品名翻成英文；Gemini 忙線（503）時會有失敗筆數，再按一次只會補失敗的
- [V] 評價（心得、品名、系所署名）與抽獎紀錄的品名也自動翻（觸發器 `translateReview`／`translateDraw`，補翻按鈕一併處理），Landing 評價、抽獎跑馬燈、商家成長獎勵頁讀英文
- [V] 商家可以手動修改英文：菜單編輯視窗、店家設定的「英文簡介」。手動改過的欄位把 `i18n_src` 設成目前中文，自動翻譯就不會蓋掉；清空＝交回自動翻譯；只改中文沒改英文＝照常重翻。`firestore.rules` 讓店主可寫 `description_en`／`i18n_src`（`i18n_src.name` 不能動，店名英文仍只有管理員／自動翻譯）
- 已知限制：店名英文與計畫方案的英文目前只能靠自動翻譯（沒有編輯介面，要改到 Firestore Console 改 `name_en` 並把 `i18n_src.name` 設成目前中文店名）
- [V] 成長獎勵門檻改存 `platform_config/growth`（`milestones`＋`voucher_total`），商家後台與 `drawGrowthReward`／`syncGrowthUnlock` 讀同一份；文件不存在時 Functions 退回原本預設值。順手修掉 `growth_rewards` 文件只有 `unlocked_milestones` 時 `voucher_remaining` 變 `NaN` 的問題
- [V] 計畫卡評分改讀 `reviews` 平均（顯示則數），沒人評過顯示「尚無評分」；`meal_plans.rating` 從型別與 seed 拿掉（正式站舊文件還留著這個欄位，不影響）。`createPlanLinePayReservation` 產生的 locks 新增 `meal_plan_id`，**之前加入的計畫沒有這個欄位，評分只算進店家平均、不會算進方案平均**
- 刻意寫死、不用改：管理員白名單 `lib/adminAuth.ts`、早鳥級距 `lib/pricing.ts`、預設取餐時段 `lib/pickupSlots.ts`

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
| QR Code 核銷 | 🟡 | 見待辦 §3；2026-09-28 補上商家端相機掃碼，待部署 hosting＋手機實測 |
| 撥款排程 | 🟡 | 見待辦 §3 |
| 取餐提醒推播（FCM，同 SU「通知系統」） | 🟡 | 程式碼由 SU 完成，VAPID key 已填，待部署驗證 |
| 我的鎖定／訂單記錄頁 | 🟡 | `MyLocksPage.tsx`，簡易列表（週曆版在 `MyBookingsPage.tsx`） |
| Gemini — 商家校準 Agent | 🟡 | Key 已到位、本機測通，待部署後在正式站驗證 |
| Gemini — 消費者折扣說明 Agent | 🟡 | 同上 |
| UI 模型建置 | ⬜ | 見待辦 §6 |
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

要寫入真實資料的管理頁，另外由 `RequireRealAdmin` 要求真實 Firebase Auth 管理員帳號登入。

---

## 設計決策與技術筆記（已完成的背景紀錄）

**資料模型統一（2026-09-23，選項 b）**：原本「商品瀏覽」這條線（從 `BunnBaa Parse_Ref` 搬來的 `VendorData`／`MenuItemData`）跟真正在跑的 `Lock`／`Vendor` 流程是兩套互不相干的資料模型。最後決定整套併進真正的 `Vendor` 模型：`VendorListPage`／`VendorPage`／`MenuItemPage`／`CartPage`／`VendorPortalMenu` 改讀寫真實 `vendors`＋`menu_items`（規則重用 `isVendorOwner()`），兩個 LINE Pay reservation function 拿掉寫死的 `CART_VENDOR_ID`，改吃每個品項的 `vendor_id` 並驗證商家存在。

**LINE Pay Sandbox 串接（2026-09-23）**：`functions/src/linePay.js`（v3 簽章＋Request/Confirm API），流程是 Request → 導向 LINE Pay → `confirmLinePayPayment` 確認後才建立 `locks`。`confirmLinePayPayment` 統一處理 `lock_drafts` 陣列，單品項（`/lock`）跟購物車多品項（每個品項×數量展開成 N 筆 `locks`）共用。端到端測試中修掉兩個 bug：
1. **hash 路由 404**：LINE Pay 導回時直接把 `?transactionId=...` 串在 `confirmUrl` 後面，不理會 `#`。改成把 `orderId` 放進路徑（`/payment/confirm/:orderId`），並做防禦性截斷。
2. **Confirm API 回「1159 交易不存在」**：`transactionId` 是 19 位數，超過 JS `Number` 的安全整數範圍，`res.json()` 會失去精度。改成解析前先把數字字面值加上引號再 `JSON.parse`，以字串保留。

**計畫型（訂閱制多日方案）**：沒有另外的 subscription collection，「預約加入計畫」付款成功後一次寫入 N 筆 `locks`（用 `plan_id`／`plan_label` 串起來），取餐日從消費者選的開始日起、跳過公休排滿 N 個營業日，不需要排程 Function。2026-09-28 前是前端直接寫、不經付款，已改走 `createPlanLinePayReservation`。

**成長獎勵抽獎**：`drawGrowthReward` 在伺服器端計算，採機率權重制，0 元券見底時自動降級成 1 折保底（機率不能信任 client）。

**早鳥階梯定價**：95／8／7 折，純函式 `web/src/lib/pricing.ts`，依 `pickupDate` 計算。

**轉讓逾時自動開放 $0 元領取**：沿用 `firestore.rules` 的 lazy expiry 規則，不需要排程 Function。

**贈送**：`for_gift` 機制沒有「指名」欄位，生成連結後私下傳給朋友，跟 QR 取餐碼「給誰就是誰的」是同一套信任模型。

**認證商家徽章**：`Vendor.verified`（只有 admin 能寫），在 `AdminSettingsPage.tsx` 勾選。

**備料聚合**：`VendorPortalPrep.tsx` 用 `onSnapshot` 依 `pickup_date`＋`pickup_window` 即時分組。

**ISO27001 技術修補（2026-09-21 已部署）**：Functions 授權（管理員／商家 owner）、`payouts`／`accuracy_reports` 只限管理員和該商家 owner 讀取、FCM token 私有化（`lock_tokens`）、`locks` 完整性規則、管理員稽核日誌、Hosting 安全標頭。煙霧測試已通過：`/lock` 鎖定、管理員狀態切換、CSP 無違規。

**Blaze 升級（2026-09-23）**：過程中卡過一次信用卡「交易遭拒」；第一次部署 `onLockCreated` 時卡在 Eventarc 權限生效，等待後重試成功。
