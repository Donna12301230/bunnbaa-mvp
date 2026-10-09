# BunnBaa 開發 TODO

**截止日：10/18 前提交 Demo ＋ 英文版 Proposal。**

對應文件：`BunnBaa_0到1架構文件.docx`（唯一權威文件）、`BunnBaa_技術規格文件_v6_消費者端補強版.docx`（都在 `doc/`）。舊雛型：`../BunnBaa Parse_Ref/`。架構與開發設定見 [README.md](README.md)。舊版詳細紀錄（每項的來龍去脈、測試過程）請看 git 歷史 `26469e2` 以前的 TODO.md。

正式站：https://bunnbaa-mvp-5474.web.app ｜ 目前正式站版本：master `abdb4c4`（2026-10-05 21:28 hosting 由 GitHub Actions 部署、Functions 由本機 `firebase deploy --only functions` 手動部署；rules／indexes 仍是 09-30 部署的版本）

---

## 🆕 2026-10-09 回饋修正（`claude/serene-knuth-vjyzk9`）

1. 報表與洞察「每天收入、材料成本與淨利」加淨利線（getDailyRevenueSeries 多回 net_profit／other_cost：扣人工、手續費、抽成、固定成本日攤）
2. $0 轉讓（自訂 0 元＋逾時免費領取）從轉讓市集移到「附近愛心餐」分頁上方（FreeTransfersSection）
3. 轉讓價對話框加「原價／早鳥價／半價／免費」快選；自訂金額本來就有（10/05 版），**要部署 `firestore.rules` 才能在正式站寫入 resale_price**
4. 代領改用 8 碼代領碼（`getProxyPickupCode`，存 `proxyCodes/{code}`，規則預設全擋）；我的餐點新增「代領取餐」分頁，免登入輸入碼或貼連結；登入後回到原頁（lib/returnPath.ts）。順手修：轉讓中／贈送中的 lock 公開可讀含 share_token，代領改限 status=locked，取消轉讓／贈送時觸發器換新 share_token
5. 廠商帳號只留「上架顯示」「廠商後台」：導覽、購物車、會員中心、收藏隱藏；會員頁導去後台；下單／轉讓／收藏擋下
6. 我的餐點月曆依早／午／晚分開，標「午（12:00）」
7. 菜單品項表單分 ①基本資料 ②內容與價格 ③過敏原，說明／飲食標記／英文／目錄收進「更多設定」；候選菜細項預設收起

部署：Functions（新 callable `getProxyPickupCode`、`issuePickupQr`／`getDailyRevenueSeries`／`matchResaleLock` 有改）＋ hosting。rules 沒改，但上面第 3 點的待部署規則仍要部署。
測試：functions.test.js 63/63（新增 C-MY-24 代領碼、C-MY-25 取消轉讓換 token、V-RPT-02 淨利）、functions-more 71/73（2 筆是「明天不是營業日」SKIP）、logic 57/57。

---

## 🆕 第一階段規格改版（`spec-phase1` 分支，2026-09-30，部署中）

依 `doc/BunnBaa 飯飽｜第一階段技術規格1002.md` 改版，保留鎖定折扣＋轉讓＋LINE Pay（對照表見 README「第一階段規格」）。
emulator 端對端測試已跑過：截單判定許願、備料清單／時間軸、QR 簽章與防截圖、備援取餐號、抽獎券累計、抽獎、截單前取消退券、捐愛心餐→預約→核銷、週／月叫貨單、區域洞察、開放許願、停班自動取消。**瀏覽器畫面還沒實際點過。**

**2026-09-30 SU 補充**：master 這次 fast-forward 進來時，GitHub Actions 已經自動把前端 Hosting 部署上去了（推上 master 就會觸發，跟 Functions/rules 是分開的部署目標）——代表這段時間正式站是「新前端＋舊後端」不一致的狀態，直到下面 rules/indexes 補上為止才恢復一致。之後如果又要 merge 大改版到 master，最好先確認 Functions/rules 能不能一起跟上，不然會有同樣的空窗期。

部署前要做：
- [x] `functions/.env` 加 `PICKUP_QR_SECRET`：2026-09-30 SU 已產生一組隨機字串（64 碼 hex），**還沒真的寫進正式站的 `functions/.env`**——本機沒有 `GEMINI_API_KEY`／`LINE_PAY_*` 這幾把既有金鑰，等雅婷把完整 `.env` 補齊再一起部署 Functions，避免用不完整的 `.env` 部署把現有能動的翻譯／LINE Pay 洗掉
- [x] 部署 `firestore:rules,firestore:indexes`：2026-09-30 SU 已部署完成（先審查過規則，沒發現安全漏洞，只有 `charityBans` 沒開放管理員讀取，但目前沒有前端頁面用到，不影響）；索引在背景建立，可能還要幾分鐘才會顯示為 Enabled
- [x] 部署 `functions,hosting`：2026-10-05 完成（`.env` 金鑰已補齊，從本機手動部署 Functions）
- [ ] **GitHub Actions 自動部署 Functions 會失敗**：repo 沒設 `FUNCTIONS_ENV` secret，workflow 會在部署前停下（保護金鑰，不會動到正式站）。設好之前 master 動到 `functions/` 都要手動 `firebase deploy --only functions`；設定方式：`gh secret set FUNCTIONS_ENV < functions/.env`
- [ ] 正式站灌 `node scripts/seed-phase1.js`（或 `--catalog-only` 只灌模板與配方）——需要服務帳號金鑰
- [ ] Firebase Console 確認新排程都有啟用：`lockOrders`、`pickupReminder`、`convertToCharity`、`closeCharity`、`expireCharityReservation`（每 5–10 分）、`closeRewardPeriod`（週一 00:10）、`buildWeeklyPurchase`（週六 12:00）、`pollDisasterFeeds`（每 15 分）（`buildMonthlyPurchase` 已依 1002 規格移除，久放品項併入週叫貨單）
- [x] 舊的 `drawGrowthReward`、`markLockOutcome`、`createLinePayReservation`、`pickupReminders`、`triggerPickupRemindersNow` 已移除；2026-10-05 再刪掉雲端上的 `buildMonthlyPurchase`（月叫貨單已取消）、`claimResoldLock`（舊的免費接手，已改付費接手）

正式站要點過一次的流程：
- [ ] 消費者：品項頁組便當（選日期、許願候選菜、不要、加減飯）→ 購物車套折價券 → LINE Pay → 我的餐點（QR、修改許願、截單前取消退款、代領連結、捐為愛心餐）
- [ ] 店家：配方與原物料（Gemini 草稿、套用模板）→ 菜單便當設定 → 今日備料（產生、勾選、列印標籤、等值替換）→ 採購叫貨（盤點、LINE 傳送）
- [ ] 店家「菜單與備料」四頁改版（設計見 [菜單與備料重新設計.md](菜單與備料重新設計.md)；emulator 已點過，截單與叫貨的 callable 因 emulator Functions 無回應沒測到）：叫貨單按「重新產生」後展開看需求來源、今日備料「LINE 叫貨」與「列印領料單」、原物料改單價的漲價影響→ 取餐掃碼 → 愛心餐 → 券負債看板 → 區域洞察
- [ ] 管理員：平台參數、菜色庫與模板、天災事件（手動建立停班事件會真的退款，先用測試訂單）、異常審核
- [ ] 手機：相機掃碼、定位（`firebase.json` 已改成 `geolocation=(self)`）

---

## ⏭ 今天（2026-09-29）

- [ ] **補設定資料**：在有正式站服務帳號金鑰的電腦上執行
  `$env:GOOGLE_APPLICATION_CREDENTIALS="金鑰檔路徑"; node scripts/seed.js --config-only`
  （只寫 `platform_config/growth`＋`landing_events`）。沒做之前 Landing「近期活動」是空的、商家成長獎勵頁顯示「平台尚未設定門檻」
- [ ] **補翻既有資料**：管理員登入正式站 → 管理後台 → 系統設定 →「補翻既有資料」。有失敗筆數（Gemini 503）就再按一次，只補失敗的。做完切英文介面看首頁、商家頁、我的餐點，店名／菜名要是英文

---

## 🔴 Demo 前要完成（10/18）

### 交付
- [ ] 整合測試：消費者、商家、管理員三條線端到端各跑一次
- [ ] 錄 Demo（3 分鐘腳本見 v6 §8）
- [ ] 撰寫英文版 Proposal（初稿：投影片 https://claude.ai/artifact/FCk692pY4uC2KmKJ2qHzQD ；表單文字與 Demo 腳本見 [Submission_EN.md](Submission_EN.md)；方括號處待補）

### 測試文件未完成項目（2026-10-05 盤點）
[測試文件.md](測試文件.md) 約 430 案例：PASS 203、作廢 4，其餘未完成（空白 135、只過伺服器／邏輯層 約 70、v4 待重測、BLOCKED、FAIL）。案例細節看測試文件，測完直接改該案例的結果欄。
- [x] **未解 bug**（2026-10-05 修）：BUG-9 轉讓期限上限 24 小時 → 31 天（規則）；BUG-10 登入後改導 `/home`；BUG-13 報表卡片改查取餐日區間、與圖表同口徑；V-PRP-01 無法重現（舊存檔日期過期），即時更新 Functions 層 PASS
  - [ ] **部署 `firestore.rules` 到正式站**（BUG-9 修正在規則裡，沒部署前正式站上架 24 小時以後的餐點仍會 PERMISSION_DENIED）
  - [ ] 前景分頁複測畫面：C-MY-03 上架 3 天後的餐點、V-RPT-01 圖表總額＝卡片、V-PRP-01 另一視窗下單後份數自動 +1
- [x] **已修但結果欄還是 FAIL**（2026-10-05 改 PASS；test:functions 59/59、test:functions:more 68/69（F-19 要 20:00 後））：C-NAV-01、C-MY-10、C-MKT-07、C-CHR-13、V-PUR-01、F-02、F-10
  - [x] C-ORD-02：2026-10-05 emulator 假金流 PASS（4 筆 locks、vendor_id 正確）；LINE Pay Sandbox 版成功頁留到正式站流程一起看
- [ ] **完全沒測的 P0**（2026-10-05 畫面測完 11 筆 PASS：C-AUTH-01、C-BAN-07、V-MNU-01、V-SET-01／04／05、V-RCP-01／02、A-VND-01、A-APL-01、N-RWD-01（BUG-14 商家後台 4 頁手機橫向捲動，已修））；剩下：
  - [x] C-ORD-01：2026-10-05 重開 emulator 後 PASS（假金流）；順帶修 BUG-15（品項頁換品項時數量沒重設）
  - [ ] C-AST-01／02、V-MNU-08／09：BLOCKED，`functions/.env.local` 在 emulator 把 `GEMINI_API_KEY` 清空，要暫時填 key 或到正式站測
  - [ ] V-RDM-10（正式站）
- [ ] **整區沒測**：3.11 預購助理（C-AST-01～13、16、17）、4.4 菜單管理（V-MNU-01～05、07～15、17）、4.5 店家設定（V-SET-01、04～08、11、12）、4.7 配方（V-RCP-01～08）、4.3 時段與訂單（V-SES-01／02、V-ORD-01～03、V-PRP-04／06／07／08／10／12／16）、5 管理後台（A-VND、A-SET、A-AUD、A-DSH）、第四道備案遞補（C-BNT-20～23）
- [ ] **v4 改版待重測**：C-MY-17、C-BNT-08、C-RWD-08、C-PLN-01（金額）、V-PRP-17（伺服器＋畫面）；畫面原本 BLOCKED 現已可測：C-BNT-09、C-CHR-05
- [ ] **伺服器 PASS、畫面待測**（約 70 筆，結果欄寫「畫面待測」）：先補 P0 的 C-PRC-02、C-ORD-09、C-MY-02、C-MKT-02、C-BAN-02／04、C-AST-14、C-MTC-01、C-BNT-12、C-RWD-03／06、C-MEAL-01、V-RDM-02、V-PRP-02／09／11／14、V-SET-03、V-PUR-02、V-CHR-03、V-INS-02、V-WAGE-02、V-REV-02、A-CFG-01
- [ ] **只能在正式站測**：C-NAV-03、C-AUTH-04／05（OTP）、C-CHR-06、C-MY-13、C-MTC-09、C-CHR-14、V-RDM-13／14／16、V-MNU-10、V-PUR-08、V-REV-06、A-SET-02、A-AUD-01、A-DIS-08、F-11、F-12、N-SEC-01～03、N-PRF-01
- [ ] **第二家店綁定後**：V-ACC-02、V-RDM-09、V-MNU-06（見下方「需要第二家商家綁店主才能測」）。emulator 已可測：2026-10-05 A-VND-01 把 applicant@ 綁到「早安三明治」（`zaoan-sandwich`），`dev:emulator:reset` 後要重新核准
- [ ] **端到端情境 A～H**（測試文件第 9 章）一次都還沒跑；部署前至少跑 A、C、G
- [ ] **部署前回歸清單**（測試文件第 10 章）：規則測試已 64/64（2026-10-05）；還缺 P0 全 PASS、Scheduler 時區、`menu_embeddings` 索引＋`backfillMenuEmbeddings`

### 正式站驗證（程式碼已部署，還沒在正式站實際點過）
- [ ] **「加入計畫」走 LINE Pay**：會員按「預約加入計畫」→ 選第一天＋時段（預覽要跳過公休日；09-29 看過對話框能開，但 5 家商家都沒設公休／週休，要先幫一家設公休日才測得到）→ 勾聲明 → LINE Pay Sandbox 付款 → 付款成功頁出現 N 張 QR → `/my-bookings` 看到 N 筆、`plan_id` 相同。負面：把某天訂滿，要被擋並說明哪一天額滿
- [ ] **「加入計畫」被封鎖時的白話提示**：封鎖測試會員後按「預約加入計畫」（`customer@bunnbaa.test` 申訴已核准、目前沒被封鎖，要重新封鎖才測得到），要看到「您的帳號因多次未取餐已被限制下單…」，不是 `Missing or insufficient permissions.`
- [ ] **QR 相機掃碼**（`QrScannerDialog.tsx`，只過 `tsc`＋`build`；09-29 已確認正式站 header 是 `camera=(self)`）：
  1. 消費者手機 `/my-bookings` →「使用」顯示 QR
  2. 店主用另一支手機開 `/lock/vendor/redeem` →「用相機掃描 QR Code」，iPhone Safari＋Android Chrome 各試一次
  3. 掃到後自動帶入末 8 碼 → 「確認取餐」成功；付款成功頁的 QR 也掃一次
  4. 負面：重掃同一張 →「已經是已完成取餐」；掃桌位 QR →「這不是 BunnBaa 的取餐 QR Code」；拒絕相機權限 → 顯示改用手動輸入
- [ ] **購物車跨店結帳**：用非仁和雅的品項走一次購物車，到 Firestore 確認 `locks.vendor_id` 是正確商家
- [ ] 撥款排程：`settleVendorPayouts`＋手動觸發
- [ ] 成長獎勵抽獎：先跑一次 `triggerSettlementNow`（或等 20:00 排程）補上 `growth_rewards.unlocked_milestones`，再測 `drawGrowthReward`
- [x] 我的鎖定頁 `/my-locks`（`MyLocksPage.tsx`）：09-29 正式站正常顯示、console 無錯誤。小問題：列表沒照日期排序；9/24 的 $0 抽獎單過了取餐日仍是「已鎖定」
- [ ] 評分（09-29 確認 9/25 已取餐那筆有「評分／留下回饋」、表單正常，還沒送出）：`/my-bookings` 已取餐的餐點打分 → 首頁計畫評分、Landing 評價出現；同一筆再評要被擋
- [ ] 商家頁（`/vendor/:id`）手機版面：2026-09-29 再改版（底線分類標籤預設選第一類、品項改單欄＋品項縮圖＋圓形「+」快速加入購物車、商家名旁加星等、電話提醒區塊），`tsc`／`build` 已過，還沒在真手機／裝置模式下看過（仁和雅只有「便當」一個分類，要挑多分類的店）
- [ ] **提前登記未取餐要被擋**（`e50e527`）：店主開 `/lock/vendor/redeem` 查明天的單，「登記未取餐」要是灰的、滑鼠移上去有提示；商家後台訂單列同樣。取餐時段結束後才可按

### 需要第二家商家綁店主才能測
目前正式站只有仁和雅咖啡有店主帳號。綁法：廠商申請 → `/admin/vendors` 核准。
- [ ] 用第二家店主帳號看商家後台各頁，只看得到自己的資料（驗證拿掉寫死的 `cafe-renheya-demo`）
- [ ] 別家店主呼叫 `markLockOutcome` 要回 `permission-denied`：用**手動輸入末 8 碼或直接呼叫**（相機掃碼前端就先擋了，測不到）。打已 `fulfilled` 的仁和雅鎖定，例：`F1S63VpLVZqDxVTvdHp0`／`XVTVDHP0`——擋不住也只會回 `failed-precondition`，不會寫入

### 清除正式站測試資料
- [ ] Firestore Console 刪除：
  - `customer@bunnbaa.test` 名下「A方案：五日輕食計畫」5 筆 locks：`3FISlB1jhR7o8hVo4YHo`、`4XYmoY4zyhT1kFaHATzz`（no_show，會被算進校準報告）、`JBeV9Xc7C58da8YF09xv`、`GtAMfgcFRBymMQ2cdjXh`、`jNnDK42dOdMF75jckhWe`
  - `ban_appeals/lI5dGTVtIBfByBIUTy3W`
  - 仁和雅店主名下的份數測試訂單 `EJEL6PRO`（可選）

---

## 🟡 10/10 後（SU 一次驗證）

- [ ] 取餐提醒推播：`pickupReminders`／`triggerPickupRemindersNow`（真機）
- [ ] 商家校準報告＋what-if 追問：`dailyCalibration`／`askCalibrationScenario`、`reliability_tone`
- [ ] 手機門號 OTP 登入：正式站用真手機號碼收一次簡訊

---

## 📝 2026-10-05 需求（2026-10-07 SU 實作，`su` 分支，尚未部署）

驗證：`tsc`＋`vite build` 過、`test:logic` 50/50、`test:rules` 65/65、`test:functions` 60/60、`test:functions:more` 72/73（F-19 要 20:00 後）。2026-10-07 在本機 emulator＋Chrome 看過新畫面（取消換券、轉讓價視窗、管理目錄、商家頁目錄分頁、訂單排序與核銷碼、合作方案卡片、收益看板的平台抽成），結果記在測試文件；付費接手的實際扣款與退款（C-MKT-09）還沒測。

- [x] **取消退款規則改版**：取餐時段開始前 48 小時可取消，不退現金，改發一張同店家折價券（原價＋加減項的 30%，不超過實付；效期 `couponValidDays` 30 天，`coupons.tier = "refund"`）。下單時用的券照舊退回。停班停課仍是全額退款。參數 `cancelHoursBefore`、`cancelCouponRate`。
- [x] **商業模式改版**：抽成取代月費（SU 2026-10-07 決定不並存）。`commissionRate` 5%，以每份實付金額計、逐份四捨五入，撥款時扣（`payouts` 多 `gross_amount`／`commission_amount`）；收益看板的「平台維護費」改成「平台抽成」。月費、首月免費、到期擋後台、寬限／暫停接單、管理員續約全部拿掉。菜單價格欄位旁有「加 5%」一鍵換算。
- [x] **成長獎勵改版**：累積淨營業額（含結轉）滿 `minRevenueToOpen` 1 萬元開池，回饋 `rewardRate` 5%；抽獎券仍是每實付 100 元一張，用來決定誰能抽。
- [x] **轉讓自訂費用**：轉讓人上架時填轉讓價，0 ～ 原價（品項原價＋加減項，SU 2026-10-07 決定上限是原價）。原付款人退款＝實付與轉讓價取小的。
- [x] **取餐掃碼與訂單管理合併同一頁**：已在「訂單取餐」頁；訂單列第一欄改成核銷碼（4 碼取餐號＋手機末三碼）。
- [x] **菜單管理加入目錄分類**：目錄 > 分類 兩層。`menu_items.catalog`＋`vendors.menu_catalogs`（順序）；菜單管理頁「管理目錄」可新增、改名、排序、刪除；消費者商家頁有兩個以上目錄時先切目錄。
- [x] **訂單依時間排序**：訂單列表可切換「取餐時間／下單時間」，選擇會記在瀏覽器。
- [ ] **退款折扣券疊加**：待跟雅婷討論。目前行為跟一般折價券一樣——每份餐點限用一張券、早鳥折扣照算。
- 不做：訂購頁顯示購物車側邊欄（購物車維持右下角面板）。

### 這次改版部署前要做
- [ ] **rules、Functions、hosting 一起部署**（轉讓價與目錄靠新規則；取消、抽成、開池靠新 Functions）。
- [ ] **刪掉雲端上兩支已移除的 function**：`firebase functions:delete billingCycle onMenuItemListed --region asia-east1`。不刪的話，沒加 `--force` 的部署會停下來問。
- [ ] **改正式站的 `platformConfig/global`**：這份文件存的值會蓋過程式預設。如果裡面已經有 `rewardRate: 0.1`，要到管理後台「平台參數」改成 0.05，並確認 `minRevenueToOpen` 10000、`cancelHoursBefore` 48、`cancelCouponRate` 0.3、`commissionRate` 0.05 都有值（或重跑 `node scripts/seed-phase1.js --catalog-only` 整份覆寫）。
- [ ] **已經在跑的回饋期**：部署當週結算就會用新規則（營業額門檻、5%）。已開池、已發出的券不受影響。

### 這次改版留下、要跟雅婷確認的事
- [ ] **取消留在店家的款項（`locks.kept_amount`）怎麼入帳**：目前會跟著撥款撥給店家並照抽 5%，但**不算進收益看板與統計報表的營收**（那邊只算沒取消的訂單）。要不要算、要不要抽成，請確認。
- [ ] **取消不退現金的法律面**：現做餐點可排除 7 天猶豫期，但「取餐 48 小時前取消也只退 30% 折價券」是否符合消保法與定型化契約規範，上線前請確認；條款文字已照新規則改（`TermsNotices.tsx`）。
- [ ] **轉讓價高於轉讓人實付時**：多出來的錢留在店家（LINE Pay 退款不能超過原付款額），轉讓人不會獲利。如果希望轉讓人拿到差額，要另外做撥款給個人的機制。
- [ ] **開池時的券種**：回饋降到 5% 後，1 萬元營業額的回饋池是 500 元；抽獎券接近 100 張時幾乎全部只夠發保底九五折券（折 5 元），免費餐券、半價券要營業額明顯高於抽獎券數 × 100 才會出現。要不要調整券種或保底面額，請確認。
- [x] **文件已跟上**（2026-10-07）：技術規格 1002 的 §1、§2、§4.1、§8、§9、§12～§16 與測試文件（V-BIL-01～04、V-ACC-04／05 作廢；新增 V-FEE-01／02、C-CXL-01、C-MY-18、C-MKT-09、V-MNU-18～20、V-ORD-04、R-12d）。
- 舊欄位不再使用、沒有清：`vendors.subscription_*`、`vendors.billing`、`rewardStatus.min_tickets`；`scripts/seed.js`／`seed-scale.js` 還會寫 `subscription_*`（無作用）。

---

## ⚪ Demo 後／有空再做

- [ ] **Functions runtime 升級（2026-10-30 前）**：Node.js 20 停用後無法再部署 Functions。`functions/package.json` engines 升 Node 22＋`firebase-functions@latest`（有 breaking changes，要重測）
- [ ] 份數上限邊界測試：兩人同時搶最後一份（只能一人成功、另一人不扣款）、LINE Pay 確認失敗時份數退回
- [ ] CSP 長期觀察無違規後，`firebase.json` 的 `Content-Security-Policy-Report-Only` 改成強制
- [ ] LINE Pay／綠界特約商店審核（Demo 沿用 Sandbox；審過後換 `functions/.env` 的 Channel ID/Secret＋`LINE_PAY_ENV=production`，程式碼不用改）
- [ ] **待跟雅婷討論**：`ckchildlikekid@gmail.com` 開 2FA；GitHub `master` branch protection（會改變推 master 自動部署的流程）
- [ ] ISMS 風險登錄表剩餘項目：Firestore 備份、Secret Manager（見 [ISMS_管理制度文件.md](ISMS_管理制度文件.md)）
- [ ] 店名英文、計畫方案英文沒有編輯介面（目前只能在 Firestore Console 改 `name_en` 並把 `i18n_src.name` 設成目前中文）
- 暫緩：Cloud Audit Logs 資料讀寫（只有事後鑑識用途，正式商轉再開）

---

## ⚠️ 部署注意事項

- **rules、Functions、hosting 要一起部署**：前端呼叫格式（`lang`、`menu_item_id`＋`pickup_date` 等）與規則（`locks` 前端不能建立）都跟 Functions 綁在一起，只上一半會壞
- 有新的複合索引時，**索引要先建好**再上前端，否則查詢直接失敗（emulator 不檢查索引，本機測不到）
- Functions 部署逾時：用 `FUNCTIONS_DISCOVERY_TIMEOUT=60 npx firebase deploy --only functions`（Git Bash 語法）
- 推 `master` 會由 GitHub Actions 自動部署 hosting

---

## ✅ 已完成摘要

- **基礎**：Firebase（Blaze）、Hosting、Firestore 規則＋索引、ISO27001 技術修補、安全標頭
- **付款**：LINE Pay Sandbox 端到端（單品、購物車、加入計畫共用 `confirmLinePayPayment`）；價格一律由伺服器從 `menu_items` 重算
- **取餐**：取餐日期／時段選擇、商家自訂時段／公休／份數上限（transaction 預扣，先扣份數再扣款）
- **核銷**：QR 核銷正式站驗證（確認取餐、登記未取餐、重複核銷被擋、一般會員被擋）；伺服器端狀態檢查
- **封鎖與申訴**：未取餐 2 次自動封鎖 → 會員中心申訴 → 管理員核准解除，正式站整條驗證完成
- **轉讓**：接手、贈送、取消轉讓、逾時 $0 領取；`transferred_from_uids` 讓原持有人追蹤已被接手的項目
- **登入**：真實 Firebase Auth（Email＋密碼、手機 OTP），停用匿名登入；管理員白名單新增 `ckchildlikekid@gmail.com`
- **商家後台**：全部改讀真實資料（總覽、訂餐時段／明細、訂單管理、統計報表、菜單、備料、成長獎勵、店家設定），`mockData.ts` 已刪除；揪團預購／現場點餐決定不做，改用 locks 模型
- **消費端**：預約日曆篩選＋排序、Landing 讀真實資料、評分機制 `reviews`、地區篩選（縣市＋鄉鎮市區）；2026-09-29 根路徑 `/` 不管有沒有登入一律先看 `LandingPage`（品牌形象頁），不再強制跳登入頁或直接進訂購頁
- **英文版**：消費端、商家後台、管理後台全部中英切換；Functions 錯誤訊息依語言；資料庫內容由 Gemini 自動翻譯（觸發器寫 `*_en`），商家可手動改英文；推播依語言
- **合作方案**：2026-10-07 起不收月費，改成每份餐點抽成 5%（原本的訂閱狀態、到期擋後台、管理員續約已移除）
- **Gemini**：API key 用沒綁帳單的專案（免費層），模型 `gemini-3.6-flash`，503／429 自動重試
- **資安**：SU 帳號 2FA、Firebase API key referrer 限制、ISMS 管理制度文件 v1

---

## 📌 環境備忘（新機器／新 session 開工前先看）

- **帳號**：GCP/Firebase 專案掛在 `ckchildlikekid@gmail.com`（鍾雅婷），**不是** `tom040798@gmail.com`。CLI 與瀏覽器都要用前者
- **路徑雷**（路徑含中文和 `+`）：
  - Firebase emulator 要從 ASCII junction `C:\Users\USER\bunnbaa-dev` 執行。重建：`rmdir C:\Users\USER\bunnbaa-dev` 後在 cmd 跑 `mklink /J C:\Users\USER\bunnbaa-dev "D:\雅婷\03赫滋與羊\+程式碼\BunnBaa"`
  - Vite dev server **要留在中文路徑** `D:\雅婷\03赫滋與羊\+程式碼\BunnBaa\web`，從 junction 跑會空白頁
- **Java**：emulator 需要 JRE，已裝 Microsoft OpenJDK 21
- **`web/.env.local` 的 `VITE_USE_EMULATORS`**：`true` 連 emulator、`false` 連雲端（目前 `false`）。正式建置不會誤連 emulator
- **本機開發**：`npm run dev` 只開 Vite :5300，⚠️ **直接讀寫正式資料**。要隔離：`.env.local` 改 `true` 後 `npm run dev:emulator`（重灌用 `npm run dev:emulator:reset`；emulator 視窗要 Ctrl+C 關才會存檔）
- **設計系統預覽**：http://localhost:5300/#/design-system
- **網域**：`bunnbaa.com` 掛在舊 Parse 專案，MVP 暫用 https://bunnbaa-mvp-5474.web.app
- **GitHub**：https://github.com/Donna12301230/bunnbaa-mvp （private）
- **刻意寫死、不用改**：管理員白名單 `lib/adminAuth.ts`、早鳥級距 `lib/pricing.ts`、預設取餐時段 `lib/pickupSlots.ts`

---

## 測試帳號

瀏覽不用登入；鎖定／下單／結帳／轉讓接手／抽獎要先登入（沒有匿名身分）。

**本機 emulator**（`scripts/seed.js` 自動建立）：

| 角色 | Email | 密碼 | 說明 |
|---|---|---|---|
| 一般會員 | customer@bunnbaa.test | demo1234 | `/profile` |
| 廠商 | vendor@bunnbaa.test | demo1234 | 綁定仁和雅咖啡，`/vendor-portal/dashboard`、`/lock/vendor/redeem` |
| 管理員 | suw192336@gmail.com | demo1234 | `/admin/vendors`（跟正式站密碼無關） |
| 廠商申請中 | applicant@bunnbaa.test | demo1234 | 「早安三明治」申請，管理員核准後變廠商 |

已有 `.emulator-data` 存檔不會自動重灌：用 `npm run dev:emulator:reset`，或 emulator 開著時執行
`$env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"; $env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"; $env:GCLOUD_PROJECT="bunnbaa-mvp-5474"; node scripts/seed.js --catalog-only`

**正式站**：管理員 `suw192336@gmail.com`（密碼由 SU 保管）、`ckchildlikekid@gmail.com`；仁和雅咖啡店主帳號已綁定；測試會員 `customer@bunnbaa.test`。

---

## 技術筆記（踩過的雷）

- **LINE Pay 導回 404**：hash router 下 LINE Pay 把 `?transactionId=` 直接接在網址後，改成 `orderId` 放進路徑 `/payment/confirm/:orderId`
- **LINE Pay 1159 交易不存在**：`transactionId` 19 位數超過 JS 安全整數，解析前先把數字加引號以字串保留
- **hash router 不能用 `#` 錨點**：捲動到區塊要用 `scrollIntoView`
- **規則用 `diff().affectedKeys()`**：用整份文件的 `keys()` 會讓被封鎖過的人連顯示名稱都改不了
- **自動翻譯不會無限觸發**：記下原文 `i18n_src`，原文沒變就不重翻
- **Functions 語言用 AsyncLocalStorage**：同一實例會並行處理多個請求，不能用全域變數
- **Gemini 付費層陷阱**：綁了 Blaze 帳單的專案會自動變付費層（餘額 $0 → 402），key 要從沒綁帳單的專案申請
- 計畫型方案沒有 subscription collection，付款後一次寫 N 筆 `locks`（`plan_id` 串起來）；早鳥 95／8／7 折；成長獎勵抽獎在伺服器算機率；轉讓逾時靠規則 lazy expiry，不需排程
