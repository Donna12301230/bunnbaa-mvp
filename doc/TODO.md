# BunnBaa 開發 TODO

**截止日：10/18 前提交 Demo ＋ 英文版 Proposal。**

對應文件：`BunnBaa_0到1架構文件.docx`（唯一權威文件）、`BunnBaa_技術規格文件_v6_消費者端補強版.docx`（都在 `doc/`）。舊雛型：`../BunnBaa Parse_Ref/`。架構與開發設定見 [開發指南.md](開發指南.md)。已完成項目的紀錄請看 git 歷史（2026-10-09 整理前的版本：`git show d087ca5:doc/TODO.md`）。

正式站：https://bunnbaa-mvp-5474.web.app ｜ 部署狀態（2026-10-09 查）：
- **Hosting、Functions**：推 `master` 由 GitHub Actions 自動部署，目前是 10/09 12:45 的 `00c1734`（74 支 Functions、Node 22）。之後 `d087ca5` 那次 Hosting 部署失敗，是 Action 安裝 firebase-tools 時 npm 回 404（`express@5.3.0`），不是程式問題；那次只改文件，正式站內容不受影響，下次推 master 會重新部署
- **Firestore rules／indexes**：沒有自動部署，要手動，見下方「部署與正式站資料」

---

## 🔴 10/18 前要完成

### 交付
- [ ] 整合測試：消費者、商家、管理員三條線端到端各跑一次
- [ ] 錄 Demo（腳本見 [Submission_EN.md](Submission_EN.md) 第 2 節）
- [ ] 英文版 Proposal：投影片 https://claude.ai/artifact/FCk692pY4uC2KmKJ2qHzQD 方括號處待補（團隊、剩食統計、影片連結）、匯出 PDF；`Submission_EN.md` 方括號處待補

### Google Cloud 補強（10/10–10/14，細節見 [GoogleCloud改動建議.md](GoogleCloud改動建議.md)）
**`README.md`／`README.zh-TW.md` 已經寫成這些都做完的樣子**，程式碼還沒有。哪一項確定做不完，就把 README 對應段落移到「Roadmap／後續規劃」，不要讓評審在 repo 裡找不到 README 寫的東西。
- [ ] 10/10 **P0 Vertex AI**：`functions/src/gemini.js` 改用 `@google/genai`（`vertexai: true`）；服務帳號加 `roles/aiplatform.user`、啟用 Vertex AI API；確認 embedding 仍是 768 維；拿掉 `functions/.env.example`、`開發指南.md`、GitHub secret `FUNCTIONS_ENV` 裡的 `GEMINI_API_KEY`
- [ ] 10/10 **P0 BigQuery 同步**：裝 Stream Firestore to BigQuery 擴充功能（`locks`、`menu_items`、`vendors`、`payment_intents`，dataset `bunnbaa_analytics`、asia-east1）、`fs-bq-import-collection` 回填、`fs-bq-schema-views` 產生 view
- [ ] 10/11 補 60～90 天模擬鎖定 → `daily_demand` view ＋ `AI.FORECAST` → 排程函式寫回 `vendors/{v}/forecast`、店家後台顯示「預估明天約 N 份（參考）」
- [ ] 10/12 購物籃（self-join）、`ML.KMEANS` 分群、`AI.GENERATE` 分群說明
- [ ] 10/13 Looker Studio 儀表板（每日鎖定、預測 vs. 實際、救回份數、愛心餐、客群），嵌進管理後台
- [ ] 10/14 部署正式站、全流程測試；更新 `doc/ISMS_管理制度文件.md` 的資料流（BigQuery、Vertex 區域）

### GitHub 門面（10/15–10/17，評審會看 repo）
- [ ] 把 README／README.zh-TW／LICENSE／`.gitignore` 改動 commit 並合併進 master（目前在 `Donna` 分支、未 commit）
- [ ] 兩份 README 補方括號：展示影片連結、簡報 PDF 連結、repo 網址；英文版團隊成員要不要改成英文拼音
- [ ] 建 `assets/`：用 Google Cloud 架構圖工具（官方圖示）照 README 的五層架構重畫 `architecture.png`、錄一段 10 秒左右的 `demo.gif`（預購助理或轉讓媒合）、幾張 App 截圖，嵌進兩份 README 最上面
- [ ] Cloud Functions 數量（README 寫 74）在加了預測排程後重數一次：在 `functions/` 執行 `node -e "console.log(Object.keys(require('./src/index.js')).length)"`
- [ ] README 的測試數字（logic 61、Functions 141）在最後一次跑測試後更新
- [ ] 推上 GitHub 後看一次 README：Mermaid 架構圖有正常顯示、徽章、連結都能點
- [ ] **repo 目前是 private**：設成公開（或確認評審有權限），並把 repo 網址填進 `Submission_EN.md` 與報名表單

### 部署與正式站資料
- [ ] **部署 `firestore:rules,firestore:indexes`**：10/05 之後的規則都還沒手動部署過——BUG-9 轉讓期限 31 天（沒部署前上架 24 小時以後的餐點會 PERMISSION_DENIED）、轉讓價 `resale_price`、目錄分類、`wallets`／代領碼 `proxyCodes` 規則、`holds` collectionGroup 索引、`menu_embeddings` 向量索引
- [ ] 部署索引後，管理員呼叫一次 `backfillMenuEmbeddings`（轉讓媒合才找得到既有品項）
- [ ] **檢查正式站 `platformConfig/global`**（文件裡的值會蓋過程式預設）：`rewardRate` 0.05、`minRevenueToOpen` 10000、`cancelHoursBefore` 48、`cancelCouponRate` 0.3、`commissionRate` 0.05；不對就到管理後台「平台參數」改，或重跑 `node scripts/seed-phase1.js --catalog-only`
- [ ] 正式站灌 `node scripts/seed-phase1.js`（或 `--catalog-only` 只灌模板與配方）——需要服務帳號金鑰
- [ ] 確認 09-29 這兩件做過沒：
  - 補設定資料：`$env:GOOGLE_APPLICATION_CREDENTIALS="金鑰檔路徑"; node scripts/seed.js --config-only`（沒做的話 Landing「近期活動」是空的）
  - 補翻既有資料：管理後台 → 系統設定 →「補翻既有資料」，有失敗筆數就再按一次；做完切英文看店名／菜名
- [ ] Firebase Console 確認排程都有啟用：`lockOrders`、`pickupReminder`、`convertToCharity`、`closeCharity`、`expireCharityReservation`、`closeRewardPeriod`、`buildWeeklyPurchase`、`pollDisasterFeeds`、`releaseStalePointHolds`、`settleVendorPayouts`、`dailyCalibration`

### 測試（[測試文件.md](測試文件.md)，2026-10-05 盤點：約 430 案例，PASS 203、作廢 4）
測完直接改該案例的結果欄。
- [ ] 前景分頁複測畫面：C-MY-03 上架 3 天後的餐點（要先部署 rules）、V-RPT-01 圖表總額＝卡片、V-PRP-01 另一視窗下單後份數自動 +1
- [ ] C-ORD-02 LINE Pay Sandbox 版的成功頁（emulator 假金流已 PASS）
- [ ] **還沒測的 P0**：C-AST-01／02、V-MNU-08／09（emulator 沒有 Gemini 金鑰，到正式站測）；V-RDM-10（正式站）
- [ ] **整區沒測**：3.11 預購助理（C-AST-01～13、16、17）、4.4 菜單管理（V-MNU-01～05、07～15、17）、4.5 店家設定（V-SET-01、04～08、11、12）、4.7 配方（V-RCP-01～08）、4.3 時段與訂單（V-SES-01／02、V-ORD-01～03、V-PRP-04／06／07／08／10／12／16）、5 管理後台（A-VND、A-SET、A-AUD、A-DSH）、第四道備案遞補（C-BNT-20～23）
- [ ] **v4 改版待重測**：C-MY-17、C-BNT-08、C-RWD-08、C-PLN-01（金額）、V-PRP-17（伺服器＋畫面）；畫面現已可測：C-BNT-09、C-CHR-05
- [ ] **伺服器 PASS、畫面待測**（約 70 筆，結果欄寫「畫面待測」）：P0 大多已補看（2026-10-07 補了 C-ORD-09、C-BAN-02／04、C-AST-14、C-RWD-03、V-RDM-02、V-WAGE-02），還剩：C-MTC-01（鈴鐺通知）、C-BNT-12 與 C-MEAL-01（各剩一部分）、V-PRP-11、V-CHR-03、V-INS-02（要一家附近不到 20 人的店）、V-SET-03（上限 12 個）、A-CFG-01（前台文字跟著變）、C-BAN-02（購物車路徑）
- [x] **付費接手的扣款與退款**：C-MKT-09 已補自動化測試（emulator 假金流，2026-10-07）；Sandbox 實際付款留到正式站流程一起看
- [ ] **只能在正式站測**：C-NAV-03、C-AUTH-04／05（OTP）、C-CHR-06、C-MY-13、C-MTC-09、C-CHR-14、V-RDM-13／14／16、V-MNU-10、V-PUR-08、V-REV-06、A-SET-02、A-AUD-01、A-DIS-08、F-11、F-12、N-SEC-01～03、N-PRF-01
- [ ] **第二家店綁定後**：V-ACC-02、V-RDM-09、V-MNU-06（見下方「需要第二家店主才能測」）。emulator 可測：A-VND-01 把 applicant@ 綁到「早安三明治」（`zaoan-sandwich`），`dev:emulator:reset` 後要重新核准
- [ ] **端到端情境 A～H**（測試文件第 9 章）一次都還沒跑；部署前至少跑 A、C、G
- [ ] **部署前回歸清單**（測試文件第 10 章）：還缺 P0 全 PASS、Scheduler 時區、`menu_embeddings` 索引＋`backfillMenuEmbeddings`

### 正式站要實際點過一次的流程
- [ ] 消費者：品項頁組便當（選日期、許願候選菜、不要、加減飯）→ 購物車套折價券 → LINE Pay → 我的餐點（QR、修改許願、截單前取消、代領碼、捐為愛心餐）
- [ ] 店家：配方與原物料（Gemini 草稿、套用模板）→ 菜單便當設定 → 今日備料（產生、勾選、列印標籤、等值替換）→ 採購叫貨（盤點、LINE 傳送）
- [ ] 店家「菜單與備料」四頁改版（設計文件已刪，要看用 `git show 654ceb0:doc/菜單與備料重新設計.md`）：叫貨單按「重新產生」後展開看需求來源、今日備料「LINE 叫貨」與「列印領料單」、原物料改單價的漲價影響 → 取餐掃碼 → 愛心餐 → 券負債看板 → 區域洞察
- [ ] 管理員：平台參數、菜色庫與模板、天災事件（手動建立停班事件會真的退款，先用測試訂單）、異常審核
- [ ] **加入計畫走 LINE Pay**：會員按「預約加入計畫」→ 選第一天＋時段（預覽要跳過公休日；要先幫一家設公休日才測得到）→ 勾聲明 → LINE Pay Sandbox 付款 → 付款成功頁出現 N 張 QR → `/my-bookings` 看到 N 筆、`plan_id` 相同。負面：把某天訂滿，要被擋並說明哪一天額滿
- [ ] **加入計畫被封鎖時的白話提示**：重新封鎖 `customer@bunnbaa.test` 後按「預約加入計畫」，要看到「您的帳號因多次未取餐已被限制下單…」，不是 `Missing or insufficient permissions.`
- [ ] **QR 相機掃碼**（`QrScannerDialog.tsx`）：
  1. 消費者手機 `/my-bookings` →「使用」顯示 QR
  2. 店主用另一支手機開 `/lock/vendor/redeem` →「用相機掃描 QR Code」，iPhone Safari＋Android Chrome 各試一次
  3. 掃到後自動帶入 → 「確認取餐」成功；付款成功頁的 QR 也掃一次
  4. 負面：重掃同一張 →「已經是已完成取餐」；掃桌位 QR →「這不是 BunnBaa 的取餐 QR Code」；拒絕相機權限 → 顯示改用手動輸入
- [ ] **購物車跨店結帳**：用非仁和雅的品項走一次購物車，到 Firestore 確認 `locks.vendor_id` 是正確商家
- [ ] 撥款排程：`settleVendorPayouts`＋`triggerSettlementNow` 手動觸發
- [ ] 成長獎勵：回饋期結算（`closeRewardPeriod`／`triggerRewardPeriodNow`）開池後，用 `drawTicket` 抽一次
- [ ] 評分：`/my-bookings` 已取餐的餐點打分 → 首頁計畫評分、Landing 評價出現；同一筆再評要被擋
- [ ] 商家頁（`/vendor/:id`）手機版面：真手機／裝置模式看一次，挑多分類的店（仁和雅只有「便當」一類）
- [ ] **提前登記未取餐要被擋**：店主開 `/lock/vendor/redeem` 查明天的單，「登記未取餐」要是灰的、滑鼠移上去有提示；商家後台訂單列同樣。取餐時段結束後才可按
- [ ] 手機：定位（`firebase.json` 已是 `geolocation=(self)`）
- [ ] 小問題（09-29 看到，確認還在不在）：我的餐點列表沒照日期排序；9/24 的 $0 抽獎單過了取餐日仍是「已鎖定」

### 需要第二家店主才能測
目前正式站只有仁和雅咖啡有店主帳號。綁法：廠商申請 → `/admin/vendors` 核准。
- [ ] 用第二家店主帳號看商家後台各頁，只看得到自己的資料
- [ ] 別家店主呼叫 `completePickup` 要回 `permission-denied`：用**手動輸入或直接呼叫**（相機掃碼前端就先擋了，測不到）。打已取餐的仁和雅鎖定，例：`F1S63VpLVZqDxVTvdHp0`——擋不住也只會回 `failed-precondition`，不會寫入

### 清除正式站測試資料
- [ ] Firestore Console 刪除：
  - `customer@bunnbaa.test` 名下「A方案：五日輕食計畫」5 筆 locks：`3FISlB1jhR7o8hVo4YHo`、`4XYmoY4zyhT1kFaHATzz`（no_show，會被算進校準報告）、`JBeV9Xc7C58da8YF09xv`、`GtAMfgcFRBymMQ2cdjXh`、`jNnDK42dOdMF75jckhWe`
  - `ban_appeals/lI5dGTVtIBfByBIUTy3W`
  - 仁和雅店主名下的份數測試訂單 `EJEL6PRO`（可選）

---

## 🟡 SU 真機驗證

- [ ] 取餐提醒推播：`pickupReminder`（真機收推播）
- [ ] 商家校準報告＋what-if 追問：`dailyCalibration`／`triggerCalibrationNow`／`askCalibrationScenario`、`reliability_tone`
- [ ] 手機門號 OTP 登入：正式站用真手機號碼收一次簡訊

---

## ❓ 要跟雅婷確認的事

- [ ] **退款折價券能不能疊加**：目前跟一般折價券一樣——每份餐點限用一張券、早鳥折扣照算
- [ ] **取消留在店家的款項（`locks.kept_amount`）怎麼入帳**：目前會跟著撥款撥給店家並照抽 5%，但**不算進收益看板與統計報表的營收**（那邊只算沒取消的訂單）。要不要算、要不要抽成
- [ ] **取消不退現金的法律面**：現做餐點可排除 7 天猶豫期，但「取餐 48 小時前取消也不退現金」是否符合消保法與定型化契約規範，上線前確認；條款文字在 `TermsNotices.tsx`（10/09 起退款一律改成平台點數，條款要跟著核對）
- [ ] **轉讓價高於轉讓人實付時**：多出來的錢留在店家（LINE Pay 退款不能超過原付款額），轉讓人不會獲利。如果希望轉讓人拿到差額，要另外做撥款給個人的機制
- [ ] **開池時的券種**：回饋 5% 下，1 萬元營業額的回饋池是 500 元；抽獎券接近 100 張時幾乎全部只夠發保底九五折券，免費餐券、半價券要營業額明顯高於抽獎券數 × 100 才會出現。要不要調整券種或保底面額
- [ ] `ckchildlikekid@gmail.com` 開 2FA；GitHub `master` branch protection（會改變推 master 自動部署的流程）

---

## ⚪ Demo 後／有空再做

- [ ] 份數上限邊界測試：兩人同時搶最後一份（只能一人成功、另一人不扣款）、LINE Pay 確認失敗時份數退回
- [ ] CSP 長期觀察無違規後，`firebase.json` 的 `Content-Security-Policy-Report-Only` 改成強制
- [ ] LINE Pay／綠界特約商店審核（Demo 沿用 Sandbox；審過後換 `functions/.env` 的 Channel ID/Secret＋`LINE_PAY_ENV=production`，程式碼不用改）
- [ ] ISMS 風險登錄表剩餘項目：Firestore 備份、Secret Manager（見 [ISMS_管理制度文件.md](ISMS_管理制度文件.md)）
- [ ] 店名英文、計畫方案英文沒有編輯介面（目前只能在 Firestore Console 改 `name_en` 並把 `i18n_src.name` 設成目前中文）
- [ ] 清掉不再使用的舊欄位：`vendors.subscription_*`、`vendors.billing`、`rewardStatus.min_tickets`；`scripts/seed.js`／`seed-scale.js` 還會寫 `subscription_*`（無作用）
- 暫緩：Cloud Audit Logs 資料讀寫（只有事後鑑識用途，正式商轉再開）

---

## ⚠️ 部署注意事項

- **rules、Functions、hosting 要一起上**：前端呼叫格式與規則都跟 Functions 綁在一起，只上一半會壞。推 `master` 會自動部署 Hosting 和 Functions，但 **rules／indexes 不會**——改了規則或索引的分支，合併前先手動部署 rules／indexes，否則正式站會有「新前端＋舊規則」的空窗期
- 有新的複合索引時，**索引要先建好**再上前端，否則查詢直接失敗（emulator 不檢查索引，本機測不到）
- 改 `functions/.env` 要同步更新 GitHub secret：`gh secret set FUNCTIONS_ENV < functions/.env`，不然自動部署會用舊金鑰
- 移除 function 時，沒加 `--force` 的部署會停下來問要不要刪雲端上的；自動部署會失敗，先手動 `firebase functions:delete <名稱> --region asia-east1`
- Functions 手動部署逾時：用 `FUNCTIONS_DISCOVERY_TIMEOUT=60 npx firebase deploy --only functions`（Git Bash 語法）

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
- **Gemini 付費層陷阱**：綁了 Blaze 帳單的專案會自動變付費層（餘額 $0 → 402），key 要從沒綁帳單的專案申請（改走 Vertex AI 後就不需要 key）
- 計畫型方案沒有 subscription collection，付款後一次寫 N 筆 `locks`（`plan_id` 串起來）；成長獎勵抽獎在伺服器算機率；轉讓逾時靠規則 lazy expiry，不需排程
