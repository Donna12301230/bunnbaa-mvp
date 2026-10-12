# BunnBaa Demo 影片腳本與錄製指南（3 分鐘）

對應官方說明會的五個重點：可運作的原型、語音導覽、公開存取、呼應評分標準、結構化呈現。
> **影片已另外完成**，本文件只做對照參考（檢查成片有沒有漏掉評分重點、字卡、上傳設定）。第 2 節的英文旁白照抄 `Submission_EN.md` 第 2 節，字幕初稿 [`demo_captions.srt`](demo_captions.srt) 也是照它做的；成片旁白若不同，以成片為準。

---

## 1. 影片結構與評分對照

| 段落 | 時間 | 內容 | 對應評分 |
|---|---|---|---|
| A 問題與解法 | 0:00–0:15 | 小餐館先備料後接單；預付鎖定、越早越便宜 | 問題對齊（25%） |
| B 拍照上架 | 0:15–0:45 | Gemini 看紙本菜單產生草稿，店家確認才上架 | **技術（40%）**、使用者體驗（10%） |
| C 預購助理 | 0:45–1:20 | 對話式預購、LINE Pay Sandbox 結帳 | 技術、使用者體驗 |
| D 轉讓媒合 | 1:20–1:55 | 向量搜尋找附近口味相近的人、推播、退點數 | 技術、影響 |
| E 備料與預測 | 1:55–2:25 | 截單後備料／叫貨單；BigQuery AI 7 天預測與客群 | 技術、創新（25%） |
| F 取餐與愛心餐 | 2:25–2:40 | 相機掃簽章 QR；沒取的餐變愛心餐 | 影響 |
| G 數據與架構 | 2:40–3:00 | Looker Studio（救回份數、預測 vs. 實際）、架構圖 | 技術：可擴展性；影響 |

**原則**
- B～F 全部是**正式站實機操作**，不是投影片——評審要看「能跑的原型」。
- 每個 AI 功能出現時，畫面下方加字卡寫出用到的 Google 技術。評審看字卡就知道整合深度。
- 每段都講「AI 在背後做了什麼決策」，不要只講「點這裡、點那裡」。

---

## 2. 分鏡與英文旁白

括號裡是畫面上的字卡。

### A　問題與解法（0:00–0:15）

畫面：封面投影片 → 正式站首頁，捲過早鳥價格日期列。

> Small eateries buy ingredients before anyone orders. Too much and food is wasted; too little and customers leave. BunnBaa fixes that: diners pay ahead to lock a meal, and the earlier they lock, the cheaper it is.

字卡：`Theme: Retail & Commerce — Intelligent Customer and Business Experiences`

### B　拍照上架（0:15–0:45）

畫面：店家後台 → 菜單 →「拍照上架」→ 拍紙本菜單 → 草稿出現 → 改一個過敏原 → 確認上架。

> Onboarding takes one photo. Gemini's vision model reads the menu and drafts every item — name, English name, price, dietary tags and allergens. Nothing goes live until the owner confirms it.

字卡：`Gemini multimodal on Vertex AI → structured JSON · extractMenuFromImage`

### C　預購助理（0:45–1:20）

畫面：消費者首頁 → 預購助理 → 輸入 “Lunch next Monday to Friday, Da'an, under 120, no beef” → 候選卡片 → 點一張 → 看早鳥價 → LINE Pay Sandbox 結帳（等待畫面剪掉）。

> Diners don't have to browse ten shops. They just ask. Gemini calls our server-side tools to check menus, availability and meal plans, and returns meals they can actually book. It suggests; it never buys. Booking two days ahead saves 20 percent.

字卡：`Gemini function calling · server-side tools · askShoppingAssistant`

### D　轉讓媒合（1:20–1:55）

畫面：我的餐點 → 轉讓 → 上架。切到第二支手機：推播跳出 → 點開 → 付款接手 → 回第一支手機看到點數退款。

> Plans change. Instead of wasting the meal, the diner lists it for resale. Gemini embeddings and Firestore vector search find people nearby who like similar food, and we notify them. The new buyer pays, and the original buyer is refunded automatically as platform points. That's a meal rescued — and we count every one.

字卡：`gemini-embedding-001 · Firestore Vector Search · Firebase Cloud Messaging`

### E　備料與預測（1:55–2:25）

畫面：店家後台 → 今日備料（鎖定份數、備料／叫貨清單）→ 報表 → 營收：「未來 7 天」預估卡與「常客是誰」。

> After the 20:00 cut-off, the vendor has an exact count and a ready-made prep and purchase list. For the days after that, BigQuery's TimesFM model forecasts demand, and k-means groups the regulars, with Gemini naming each group. AI advises; the vendor decides.

字卡：`BigQuery AI.FORECAST (TimesFM) · ML.KMEANS · AI.GENERATE`

### F　取餐與愛心餐（2:25–2:40）

畫面：消費者出示 QR → 店家用相機掃 → 已取餐 → 帶過愛心餐分頁。

> At the counter, a signed QR code is scanned. Any meal still unclaimed becomes a free charity meal, so it still feeds someone.

字卡：`Signed QR · Cloud Scheduler 20:00 cut-off`

### G　數據與架構（2:40–3:00）

畫面：管理後台 → 平台儀表板（Looker Studio：救回份數、預測 vs. 實際）→ 架構投影片 → 結尾頁（網址）。

> Every booking streams into BigQuery, so we can show meals saved and how close the forecast was. BunnBaa runs entirely on Google Cloud: Gemini on Vertex AI, Cloud Run functions, Firestore with vector search, BigQuery AI and Looker Studio — and we test the assistant with Vertex AI's evaluation service. Cook what's ordered. Eat what's cooked.

字卡：`Gemini on Vertex AI · Cloud Run · Firestore · BigQuery AI · Looker Studio · Gen AI Evaluation`

---

## 3. 錄影前準備（錄製時的清單，留作紀錄）

**`doc/GoogleCloud改動建議.md` 的 P0、P1 已於 10/10 部署（E、G 段與投影片第 9、11、14 頁都以此為準），只剩 Looker Studio 報表：**
- [x] P0：`functions/src/gemini.js` 改走 Vertex AI（`@google/genai`，服務帳號、移除 `GEMINI_API_KEY`），embedding 仍是 768 維
- [x] P0：Stream Firestore to BigQuery extension（`locks`、`menu_items`、`vendors`、`payment_intents`）＋回填＋schema view
- [x] P1：補 60～90 天模擬資料、`AI.FORECAST` 預測寫回 Firestore、店家報表頁顯示「預估明天 N 份（參考）」
- [x] P1：`ML.KMEANS` 客群＋`AI.GENERATE` 每群一句描述
- [ ] P1：Looker Studio 儀表板嵌入管理後台（報表還沒建，見 [TODO.md](TODO.md)）
- [x] README（中英文）、`doc/開發指南.md` 環境變數段、`doc/ISMS_管理制度文件.md` 資料流已同步更新

- [ ] 正式站已部署最新 Functions、rules、indexes，並跑過一次 `backfillMenuEmbeddings`（D 段推播才會出現）
- [ ] 帳號：店家 1、消費者 A（下單、轉讓）、消費者 B（接手；過去訂過類似菜色、常用地點在 10 公里內、今天還沒收過 2 則媒合通知）
- [ ] 一張手寫或印好的紙本菜單（B）
- [ ] 消費者 A 先訂好兩天後的一份餐（D 用），店家今天有幾筆訂單（E 備料頁才有數字）
- [ ] 介面切成英文；瀏覽器縮放到字看得清楚；關掉不相干的分頁與通知
- [ ] 先把 B～F 各彩排一次，確認 Gemini 回應速度；Vertex AI 遇到 429（配額）就等一下再錄

## 4. 錄製與剪輯

- 1080p 錄螢幕；手機畫面用鏡像投到電腦錄，或用手機內建錄影再剪進來
- 旁白另外錄（安靜環境、耳機麥克風），剪輯時對齊畫面；**一定要有語音**
- 剪掉所有等待時間：LINE Pay 跳轉、Gemini 生成中、推播延遲
- 加英文字幕（從 `demo_captions.srt` 對時）與第 2 節的技術字卡
- 總長控制在 3:00 以內

## 5. 上傳與公開設定

- YouTube：可見度選「公開」或「不公開（知道連結的人可看）」；**不要選「私人」**
- Google 雲端硬盤：共用設定改成「知道連結的任何人 → 檢視者」
- 上傳後用**無痕視窗、未登入**開一次連結，確認看得到
- 連結填進 `Submission_EN.md`、投影片結尾頁與提交表單

## 6. 交件前自我檢查

- [ ] 前 15 秒內講清楚問題與解法，並點名賽題（Retail & Commerce）
- [ ] 四個 Gemini 功能與 BigQuery AI 預測都是正式站實機操作，各有技術字卡
- [ ] 有講到「AI 在背後做了什麼」與「AI 只建議、人決定」
- [ ] 有架構畫面，看得出全部在 Google Cloud
- [ ] 有一句擴展性、一句可量化的影響
- [ ] 全程英文語音＋字幕，長度 ≤ 3:00
- [ ] 無痕視窗打得開
