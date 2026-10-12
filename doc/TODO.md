# BunnBaa 開發 TODO

**截止日：10/18 前提交 Demo ＋ 英文版 Proposal。**

對應文件：`BunnBaa_0到1架構文件.docx`（唯一權威文件）、`BunnBaa_技術規格文件_v6_消費者端補強版.docx`（都在 `doc/`）。舊雛型：`../BunnBaa Parse_Ref/`。架構與開發設定見 [開發指南.md](開發指南.md)。已完成項目的紀錄請看 git 歷史（10/09 整理前：`git show d087ca5:doc/TODO.md`；10/12 分工前：`git show fe1dc91:doc/TODO.md`）。

正式站：https://bunnbaa-mvp-5474.web.app ｜ 部署狀態（2026-10-12 查）：
- **Hosting、Functions**：推 `master` 由 GitHub Actions 自動部署，目前是 10/10 的 `fe1dc91`（79 支 Functions、Node 22），都成功
- **Firestore rules／indexes**：沒有自動部署，要手動（A 的第一件事）

---

## 分工原則

**按區域切，不按前後端切。** 每個人負責的區域從程式、部署、測試到截圖都自己做，不用等對方：

| | 工程師 A：消費者端＋後端／Google Cloud | 工程師 B：商家端＋管理後台＋投稿素材 |
|---|---|---|
| 程式 | `functions/`、消費者頁面（品項頁、購物車、我的餐點、預購助理） | `components/insights/*`、`lib/analytics.ts`、`vendor-portal/`、`admin/` |
| 正式站 | rules／indexes 部署、灌資料、排程、清測試資料、GitHub secret | 平台參數、補翻資料、Looker Studio |
| 測試 | `C-*`、`F-*`、`N-*` 案例、端到端情境 | `V-*`、`A-*` 案例、第二家店主 |
| 交付 | README 的數字、repo 公開 | 投影片、Demo、Proposal、`Submission_EN.md`、README 其他內容 |

- **測到 bug，在誰的區域就誰修**；跨區域的（例如商家後台看到的訂單資料錯）由寫入資料的那一方修。
- 兩人改的檔案不重疊，各開分支合併不會衝突。唯一共用的 README：A 只改「Functions 數量」「測試數字」那兩處，其他歸 B。
- 某項到 10/16 還沒做完，畫面本來就是「沒資料就不顯示」，不會壞，直接從 Demo 和投影片拿掉。
- 改了資料格式的人，自己更新 [GoogleCloud改動建議.md](GoogleCloud改動建議.md)「前端資料格式」表裡自己那一列。
- 兩人都要用 `ckchildlikekid@gmail.com` 的權限（gcloud、Firebase Console、Looker Studio），見下方「環境備忘」。

**Google Cloud 補強已完成（10/10，已部署）**：Vertex AI 遷移、Firestore → BigQuery 同步與回填、`AI.FORECAST` 需求預測、購物籃＋`ML.KMEANS`＋`AI.GENERATE`、儀表板 view、管理後台「平台儀表板」頁、預購助理 `getVendorInsights`、助理品質評估（24/24）、文件更新。Vertex AI Search 不做，已寫進 Roadmap。細節見 [GoogleCloud改動建議.md](GoogleCloud改動建議.md)。10/12 盤點發現 4 個前後端沒接上的地方，分別列在下面 A、B 的「Google Cloud 補強收尾」。

---

## 🔴 工程師 A：消費者端＋後端／Google Cloud

### 10/12–10/13 正式站資料（先做，C-MY-03 等測試要等這步）
- [ ] **部署 `firestore:rules,firestore:indexes`**：10/05 之後的規則都還沒手動部署過——BUG-9 轉讓期限 31 天（沒部署前上架 24 小時以後的餐點會 PERMISSION_DENIED）、轉讓價 `resale_price`、目錄分類、`wallets`／代領碼 `proxyCodes` 規則、`holds` collectionGroup 索引、`menu_embeddings` 向量索引
- [ ] 部署索引後，管理員呼叫一次 `backfillMenuEmbeddings`（轉讓媒合才找得到既有品項）
- [ ] 正式站灌 `node scripts/seed-phase1.js`（或 `--catalog-only` 只灌模板與配方）——需要服務帳號金鑰
- [ ] 確認 09-29 的補設定資料做過沒：`$env:GOOGLE_APPLICATION_CREDENTIALS="金鑰檔路徑"; node scripts/seed.js --config-only`（沒做的話 Landing「近期活動」是空的）
- [ ] Firebase Console 確認排程都有啟用並成功跑過：`lockOrders`、`pickupReminder`、`convertToCharity`、`closeCharity`、`expireCharityReservation`、`closeRewardPeriod`、`buildWeeklyPurchase`、`pollDisasterFeeds`、`releaseStalePointHolds`、`settleVendorPayouts`、`dailyCalibration`、`demandForecast`（每天 05:00）、`customerInsights`（週一 04:00）
- [ ] BigQuery：四個 extension 的 changelog 有最新時間的資料；`bunnbaa_analytics` dataset 權限只給管理員
- [ ] 刪掉 `functions/.env` 的 `GEMINI_API_KEY`，`gh secret set FUNCTIONS_ENV < functions/.env`；`doc/AI功能設計.md`、`doc/測試文件.md` 裡還提到 `GEMINI_API_KEY` 的地方改成 Vertex 說法

### 10/12–10/13 Google Cloud 補強收尾
- [ ] **常一起買**（目前不會出現：前端讀 `menu_items/{id}.often_with`，後端沒寫）：`customerInsights.js` 寫完 `analytics/basket` 後，把每個品項的配對（依 `buyers` 排序、同店、最多 5 個 id）寫到 `menu_items/{id}.often_with`；內容沒變就不要寫（會觸發翻譯與向量觸發器的檢查），配對消失時要清掉。補單元測試，重跑 `triggerCustomerInsightsNow`，到正式站品項頁確認有出現
- [ ] **助理推薦理由**（目前不會出現：`presentCandidates` 沒有這個參數）：加參數（例如 `reasons`：`[{ id, reason }]`，每則 20 字內、不催促），`buildCards` 填進卡片的 `reason`；只放有工具資料根據的理由（busier／quieter、常一起買）。前端標籤 `ShoppingAssistant.tsx` 已經有。改完重跑 `scripts/eval/assistantEval.js`，規則檢查要仍是 24/24，更新 `doc/評估/預購助理回答品質評估.md`
- [ ] 正式站實際問一次預購助理（「想挑比較不會排隊的店，順便推薦加點」），確認走 Vertex、卡片有推薦理由

### 10/13–10/15 消費者端測試（[測試文件.md](測試文件.md)，測完直接改該案例的結果欄）
- [ ] **P0**：C-AST-01／02（正式站；現在不需要 Gemini 金鑰）
- [ ] **整區沒測**：3.11 預購助理（C-AST-01～13、16、17）、第四道備案遞補（C-BNT-20～23）
- [ ] C-MY-03 上架 3 天後的餐點（要先部署 rules）；C-ORD-02 LINE Pay Sandbox 版的成功頁（emulator 假金流已 PASS）
- [ ] **v4 改版待重測**：C-MY-17、C-BNT-08、C-RWD-08、C-PLN-01（金額）；畫面現已可測：C-BNT-09、C-CHR-05
- [ ] **伺服器 PASS、畫面待測**：C-MTC-01（鈴鐺通知）、C-BNT-12 與 C-MEAL-01（各剩一部分）、C-BAN-02（購物車路徑）
- [ ] **只能在正式站測**：C-NAV-03、C-AUTH-04／05（OTP）、C-CHR-06、C-MY-13、C-MTC-09、C-CHR-14、F-11、F-12、N-SEC-01～03、N-PRF-01
- [ ] **端到端情境 A～H**（測試文件第 9 章）一次都還沒跑；至少跑 A、C、G
- [ ] **部署前回歸清單**（測試文件第 10 章）：消費者端 P0 全 PASS、Scheduler 時區、`menu_embeddings` 索引＋`backfillMenuEmbeddings`

### 10/13–10/15 正式站要實際點過一次（消費者）
- [ ] 品項頁組便當（選日期、許願候選菜、不要、加減飯）→ 購物車套折價券 → LINE Pay → 我的餐點（QR、修改許願、截單前取消、代領碼、捐為愛心餐）
- [ ] **加入計畫走 LINE Pay**：會員按「預約加入計畫」→ 選第一天＋時段（預覽要跳過公休日；B 會先幫一家設公休日，還沒設就先跳過這點）→ 勾聲明 → LINE Pay Sandbox 付款 → 付款成功頁出現 N 張 QR → `/my-bookings` 看到 N 筆、`plan_id` 相同。負面：把某天訂滿，要被擋並說明哪一天額滿
- [ ] **加入計畫被封鎖時的白話提示**：重新封鎖 `customer@bunnbaa.test` 後按「預約加入計畫」，要看到「您的帳號因多次未取餐已被限制下單…」，不是 `Missing or insufficient permissions.`
- [ ] **購物車跨店結帳**：用非仁和雅的品項走一次購物車，到 Firestore 確認 `locks.vendor_id` 是正確商家
- [ ] 成長獎勵：回饋期結算（`closeRewardPeriod`／`triggerRewardPeriodNow`）開池後，用 `drawTicket` 抽一次
- [ ] 評分：`/my-bookings` 已取餐的餐點打分 → 首頁計畫評分、Landing 評價出現；同一筆再評要被擋
- [ ] 手機：定位（`firebase.json` 已是 `geolocation=(self)`）
- [ ] 真機（SU 的手機）：取餐提醒推播 `pickupReminder`、手機門號 OTP 登入收一次簡訊
- [ ] 小問題（09-29 看到，確認還在不在）：我的餐點列表沒照日期排序；9/24 的 $0 抽獎單過了取餐日仍是「已鎖定」

### 10/15–10/17 收尾
- [ ] 截圖給 B：預購助理卡片（含推薦理由）、品項頁「常一起買」、評估結果表
- [ ] 清除正式站測試資料（Firestore Console）：
  - `customer@bunnbaa.test` 名下「A方案：五日輕食計畫」5 筆 locks：`3FISlB1jhR7o8hVo4YHo`、`4XYmoY4zyhT1kFaHATzz`（no_show，會被算進校準報告）、`JBeV9Xc7C58da8YF09xv`、`GtAMfgcFRBymMQ2cdjXh`、`jNnDK42dOdMF75jckhWe`
  - `ban_appeals/lI5dGTVtIBfByBIUTy3W`
  - 仁和雅店主名下的份數測試訂單 `EJEL6PRO`（可選）
- [ ] README 的數字：Functions 數量（README 寫 74，10/12 實數 79；最後再數一次：在 `functions/` 執行 `node -e "console.log(Object.keys(require('./src/index.js')).length)"`）、測試數字（logic 61、Functions 141，最後一次跑測試後更新）
- [ ] 最後一次合併後確認 GitHub Actions 的 Hosting、Functions 部署都成功
- [ ] **repo 目前是 private**：設成公開（或確認評審有權限），把 repo 網址給 B 填進 `Submission_EN.md`、README 與報名表單

---

## 🔴 工程師 B：商家端＋管理後台＋投稿素材

B 的項目都不用等 A：洞察卡需要的資料已經在正式站，商家與管理後台的測試不受 rules 部署影響。

### 10/12–10/13 Google Cloud 補強收尾
- [ ] **預測卡重複**：營收頁同時放了 `ForecastCard` 和 `DemandForecastCard`（都讀 `vendors/{v}/forecast`），留一張
- [ ] **客群卡永遠是空的**：`SegmentsCard`（區域分頁）讀 `vendors/{v}/segments/{id}` 集合，後端寫的是 `vendors/{v}/analytics/segments` 單一文件（陣列、欄位 `label`）。改讀正確位置，或直接刪掉、只留 `CustomerInsightsCard`；`analytics.ts` 跟著清掉沒用的型別與查詢。正式站用仁和雅確認卡片有資料、手機版面正常
- [ ] **Looker Studio 報表**（只能手動）：管理後台 `/admin/analytics` 按「在 Looker Studio 建立報表」→ 加入 `dash_forecast_vs_actual`、`dash_forecast_next`、`dash_segments` 三個 view → 排圖表（每日鎖定量、預測 vs. 實際、救回份數＝轉讓＋愛心餐、客群分布）→ 檔案 → 嵌入報表 → 開啟嵌入，把嵌入網址貼回管理後台存檔，正式站確認嵌入有顯示

### 10/12–10/13 正式站設定
- [ ] **檢查 `platformConfig/global`**（文件裡的值會蓋過程式預設）：`rewardRate` 0.05、`minRevenueToOpen` 10000、`cancelHoursBefore` 48、`cancelCouponRate` 0.3、`commissionRate` 0.05；不對就到管理後台「平台參數」改
- [ ] 補翻既有資料：管理後台 → 系統設定 →「補翻既有資料」，有失敗筆數就再按一次；做完切英文看店名／菜名
- [ ] 幫一家店設公休日（A 測「加入計畫」預覽要用）

### 10/13–10/15 商家與管理後台測試（[測試文件.md](測試文件.md)，測完直接改該案例的結果欄）
- [ ] **P0**：V-MNU-08／09（正式站；現在不需要 Gemini 金鑰）、V-RDM-10（正式站）
- [ ] **整區沒測**：4.4 菜單管理（V-MNU-01～05、07～15、17）、4.5 店家設定（V-SET-01、04～08、11、12）、4.7 配方（V-RCP-01～08）、4.3 時段與訂單（V-SES-01／02、V-ORD-01～03、V-PRP-04／06／07／08／10／12／16）、5 管理後台（A-VND、A-SET、A-AUD、A-DSH）
- [ ] 前景分頁複測畫面：V-RPT-01 圖表總額＝卡片、V-PRP-01 另一視窗下單後份數自動 +1
- [ ] **v4 改版待重測**：V-PRP-17（伺服器＋畫面）
- [ ] **伺服器 PASS、畫面待測**：V-PRP-11、V-CHR-03、V-INS-02（要一家附近不到 20 人的店）、V-SET-03（上限 12 個）、A-CFG-01（前台文字跟著變）
- [ ] **只能在正式站測**：V-RDM-13／14／16、V-MNU-10、V-PUR-08、V-REV-06、A-SET-02、A-AUD-01、A-DIS-08
- [ ] **需要第二家店主**（目前正式站只有仁和雅有店主帳號；綁法：廠商申請 → `/admin/vendors` 核准）：
  - V-ACC-02、V-RDM-09、V-MNU-06；第二家店主看商家後台各頁只看得到自己的資料
  - 別家店主呼叫 `completePickup` 要回 `permission-denied`：用**手動輸入或直接呼叫**（相機掃碼前端就先擋了，測不到）。打已取餐的仁和雅鎖定，例：`F1S63VpLVZqDxVTvdHp0`——擋不住也只會回 `failed-precondition`，不會寫入
  - emulator 可測：A-VND-01 把 applicant@ 綁到「早安三明治」（`zaoan-sandwich`），`dev:emulator:reset` 後要重新核准

### 10/13–10/15 正式站要實際點過一次（商家、管理員）
- [ ] 店家：配方與原物料（Gemini 草稿、套用模板）→ 菜單便當設定 → 今日備料（產生、勾選、列印標籤、等值替換）→ 採購叫貨（盤點、LINE 傳送）
- [ ] 店家「菜單與備料」四頁改版（設計文件已刪，要看用 `git show 654ceb0:doc/菜單與備料重新設計.md`）：叫貨單按「重新產生」後展開看需求來源、今日備料「LINE 叫貨」與「列印領料單」、原物料改單價的漲價影響 → 取餐掃碼 → 愛心餐 → 券負債看板 → 區域洞察
- [ ] **QR 相機掃碼**（`QrScannerDialog.tsx`），消費者那支手機用測試會員自己開：
  1. 消費者手機 `/my-bookings` →「使用」顯示 QR
  2. 店主用另一支手機開 `/lock/vendor/redeem` →「用相機掃描 QR Code」，iPhone Safari＋Android Chrome 各試一次
  3. 掃到後自動帶入 → 「確認取餐」成功；付款成功頁的 QR 也掃一次
  4. 負面：重掃同一張 →「已經是已完成取餐」；掃桌位 QR →「這不是 BunnBaa 的取餐 QR Code」；拒絕相機權限 → 顯示改用手動輸入
- [ ] **提前登記未取餐要被擋**：店主開 `/lock/vendor/redeem` 查明天的單，「登記未取餐」要是灰的、滑鼠移上去有提示；商家後台訂單列同樣。取餐時段結束後才可按
- [ ] 商家頁（`/vendor/:id`）手機版面：真手機／裝置模式看一次，挑多分類的店（仁和雅只有「便當」一類）
- [ ] 商家校準報告＋what-if 追問（SU 的手機）：`dailyCalibration`／`triggerCalibrationNow`／`askCalibrationScenario`、`reliability_tone`
- [ ] 撥款排程：`settleVendorPayouts`＋`triggerSettlementNow` 手動觸發
- [ ] 管理員：平台參數、菜色庫與模板、天災事件（手動建立停班事件會真的退款，先用測試訂單）、異常審核、平台儀表板

### 10/15–10/17 投稿素材
- [ ] 截圖：Looker Studio「預測 vs. 實際」「救回份數」（目前 3,659 份救回 408 份、WAPE 6～15%）、商家後台預測卡與客群卡；A 的截圖到了再一起放
- [ ] 投影片（https://claude.ai/artifact/FCk692pY4uC2KmKJ2qHzQD）：補方括號（團隊、剩食統計、影片連結）；架構圖（Firestore →（Extension）→ BigQuery → Looker Studio／`AI.FORECAST` 寫回 Firestore → 商家後台；Gemini 走 Vertex AI）；技術清單加 Vertex AI、BigQuery AI（`AI.FORECAST`、`ML.KMEANS`、`AI.GENERATE`）、Looker Studio、Gen AI Evaluation Service；Cloud Run（Functions 第二代）、Cloud Storage（Firebase Storage）、不用 AlloyDB 的理由各一句；Vertex AI Search 放「下一步」；匯出 PDF
- [ ] 錄 Demo（腳本見 [Submission_EN.md](Submission_EN.md) 第 2 節）：一定要有商家後台「未來 7 天預估（僅供參考）」、Looker Studio「預測 vs. 實際」與「救回份數」；A 的推薦理由、常一起買正式站已經有的話，再加一段預購助理
- [ ] `Submission_EN.md` 方括號處補完（影片連結、PDF、repo 網址、剩食統計）
- [ ] 兩份 README 補方括號：展示影片連結、簡報 PDF 連結、repo 網址；英文版團隊成員要不要改成英文拼音
- [ ] 建 `assets/`：用 Google Cloud 架構圖工具（官方圖示）照 README 的五層架構重畫 `architecture.png`、錄一段 10 秒左右的 `demo.gif`（建議拍轉讓媒合或商家預測卡，不用等 A）、幾張 App 截圖，嵌進兩份 README 最上面
- [ ] 推上 GitHub 後看一次 README：Mermaid 架構圖有正常顯示、徽章、連結都能點

---

## 📦 投稿交付清單（10/18 截止，對照官方規格）

所有正式文件（簡報、影片旁白與字幕、README、表單文字、程式碼註解）一律英文。規格逐項對照見 [Submission_EN.md](Submission_EN.md) 第 3 節。

### 表單上要交的 5 項
- [ ] **英文簡報 PDF**（`BunnBaa_Proposal.pdf`，10–12 頁）：從 Slides artifact 補完後匯出，見下方「簡報素材」
- [ ] **原型網址** `https://bunnbaa-mvp-5474.web.app/?lang=en`：`claude/amazing-dijkstra-uv5zcu`（英文預設語言）合併進 `master` 後才會上線
- [ ] **3 分鐘影片**：MP4 1080p，上傳 YouTube（公開或不公開但有連結），長度 ≤ 3:00
- [ ] **類別**：表單只勾 **Sustainability**
- [ ] **GitHub repo 網址**：公開前先做完下方「repo 公開前」

### 簡報素材
- [ ] 團隊頁：三位成員英文拼音姓名＋角色（照片可選）
- [x] 架構圖 `assets/architecture.png`（原始檔 `assets/architecture.html`，已嵌進兩份 README）：五層架構，標明「79 Cloud Functions, 2nd gen」跑在 Cloud Run。沒有用官方圖示（這裡抓不到）；要換官方圖示版再用 Google Cloud 架構圖工具重畫
- [ ] 剩食數據：UNEP *Food Waste Index Report 2024*（10.5 億噸、19%、餐飲服務業 2.9 億噸）**已放進簡報第 2 頁與 README**，請核對原文；要加台灣數據的話附出處
- [x] Feasibility、Scalability 兩頁：簡報第 13、15 頁已有；封面與結尾頁領域已改成 Sustainability
- [ ] 截圖（下方清單）

### 截圖清單（簡報與 README 共用，存 `assets/`）
- [ ] 消費者：首頁、品項頁（早鳥價）、預購助理對話與卡片（含推薦理由）、我的餐點 QR、轉讓上架
- [ ] 商家：拍照建菜單草稿、今日備料清單、未來 7 天預估卡、客群卡、掃碼取餐
- [ ] 管理後台：Looker Studio「預測 vs. 實際」「救回份數」
- [ ] 助理評估結果表（24/24、4.96/5、4.92/5）
- [ ] `assets/demo.gif`（約 10 秒）

### 影片
- [ ] 英文旁白（自錄或 TTS）＋英文字幕：初稿 `doc/demo_captions.srt` 已從腳本產生，剪完片要重新對時間
- [ ] 錄影前準備：紙本／手寫菜單一張（拍照建菜單用）、兩支手機（QR 掃碼、轉讓推播）
- [ ] 帳號：消費者 A、消費者 B（先鎖一份類似的菜，轉讓媒合才會觸發）、商家
- [ ] 至少一筆「明天」的已鎖定訂單（備料清單才有東西）、LINE Pay Sandbox 付款帳號
- [ ] Looker Studio 報表先建好（兩張圖要入鏡）
- [ ] 上傳後登出 YouTube 測一次連結

### 評審用 demo 帳號（正式站）
- [ ] 建 Demo Diner（消費者）、Demo Vendor（商家，綁一家有菜單與訂單的店），英文名稱；**不給管理員帳號**（可改平台參數、觸發退款）
- [ ] 帳密寫進表單備註或 README 的「Try it」段落（兩份 README 的段落已建好，只剩填帳密）
- [ ] 無痕視窗、未登入狀態把三個角色流程各走一次

### repo 公開前
- [ ] git 歷史已掃過：沒有服務帳號金鑰或 LINE Pay secret；`AIza…` 是 Firebase Web API key（設計上公開），到 GCP Console 加 HTTP referrer 限制只允許 `bunnbaa-mvp-5474.web.app`
- [ ] 個資與內部文件：本檔有管理員 Email、成員本名與分工，`ISMS_管理制度文件.md`、`ISO27001_落差分析.md` 也是內部文件——公開前移出 repo 或至少拿掉 Email
- [ ] `doc/` 的中文規格書、開發指南、`.docx`：移到私人位置，或在 README 註明 "internal notes, in Chinese"
- [x] 程式碼註解翻成英文（`claude/amazing-dijkstra-uv5zcu`，263 個檔案；只動註解，去掉註解後的程式碼逐 token 比對相同；註解裡剩下的中文是程式實際輸出或比對的文字、畫面標籤、品牌名與中文檔名路徑）。**A、B 各自的分支要先合併 master，衝突都只會在註解行**
- [ ] README 方括號：影片連結、PDF 連結、repo 網址；Functions 數量（README 寫 74，10/12 實數 79）、測試數字
- [ ] 設成 public

### 送出前最後確認
- [ ] PDF 打得開、文字可選取、10–12 頁
- [ ] 原型網址在無痕視窗打開是英文介面
- [ ] 影片登出 YouTube 仍可播放，≤ 3:00
- [ ] repo 連結登出 GitHub 可以看到
- [ ] 表單只勾 Sustainability
- [ ] GitHub Actions 最後一次部署（Hosting、Functions）成功

---

## ❓ 要跟雅婷確認的事（不分人，誰先遇到誰問）

- [ ] **退款折價券能不能疊加**：目前跟一般折價券一樣——每份餐點限用一張券、早鳥折扣照算
- [ ] **取消留在店家的款項（`locks.kept_amount`）怎麼入帳**：目前會跟著撥款撥給店家並照抽 5%，但**不算進收益看板與統計報表的營收**（那邊只算沒取消的訂單）。要不要算、要不要抽成
- [ ] **取消不退現金的法律面**：現做餐點可排除 7 天猶豫期，但「取餐 48 小時前取消也不退現金」是否符合消保法與定型化契約規範，上線前確認；條款文字在 `TermsNotices.tsx`（10/09 起退款一律改成平台點數，條款要跟著核對）
- [ ] **轉讓價高於轉讓人實付時**：多出來的錢留在店家（LINE Pay 退款不能超過原付款額），轉讓人不會獲利。如果希望轉讓人拿到差額，要另外做撥款給個人的機制
- [ ] **開池時的券種**：回饋 5% 下，1 萬元營業額的回饋池是 500 元；抽獎券接近 100 張時幾乎全部只夠發保底九五折券，免費餐券、半價券要營業額明顯高於抽獎券數 × 100 才會出現。要不要調整券種或保底面額
- [ ] `ckchildlikekid@gmail.com` 開 2FA；GitHub `master` branch protection（會改變推 master 自動部署的流程）

---

## ⚪ Demo 後／有空再做

**A**
- [ ] 份數上限邊界測試：兩人同時搶最後一份（只能一人成功、另一人不扣款）、LINE Pay 確認失敗時份數退回
- [ ] LINE Pay／綠界特約商店審核（Demo 沿用 Sandbox；審過後換 `functions/.env` 的 Channel ID/Secret＋`LINE_PAY_ENV=production`，程式碼不用改）
- [ ] ISMS 風險登錄表剩餘項目：Firestore 備份、Secret Manager（見 [ISMS_管理制度文件.md](ISMS_管理制度文件.md)）
- 暫緩：Cloud Audit Logs 資料讀寫（只有事後鑑識用途，正式商轉再開）

**B**
- [ ] CSP 長期觀察無違規後，`firebase.json` 的 `Content-Security-Policy-Report-Only` 改成強制
- [ ] 店名英文、計畫方案英文沒有編輯介面（目前只能在 Firestore Console 改 `name_en` 並把 `i18n_src.name` 設成目前中文）
- [ ] 清掉不再使用的舊欄位：`vendors.subscription_*`、`vendors.billing`、`rewardStatus.min_tickets`；`scripts/seed.js`／`seed-scale.js` 還會寫 `subscription_*`（無作用）

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
