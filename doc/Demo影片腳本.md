# BunnBaa Demo 影片腳本與錄製指南（3 分鐘）

對應官方說明會的五個重點：可運作的原型、語音導覽、公開存取、呼應評分標準、結構化呈現。
旁白一律英文（提交物必須英文），本文件的說明用中文給團隊看。**英文旁白以 `Submission_EN.md` 第 2 節為準**，字幕初稿是 [`demo_captions.srt`](demo_captions.srt)；改旁白時三處一起改。

---

## 1. 影片結構與評分對照

| 段落 | 時間 | 內容 | 對應評分 |
|---|---|---|---|
| A 問題與解法 | 0:00–0:15 | 小餐館先備料後接單；預付鎖定、越早越便宜 | 問題對齊（25%） |
| B 拍照上架 | 0:15–0:45 | Gemini 看紙本菜單產生草稿，店家確認才上架 | **技術（40%）**、使用者體驗（10%） |
| C 預購助理 | 0:45–1:20 | 對話式預購、LINE Pay Sandbox 結帳 | 技術、使用者體驗 |
| D 轉讓媒合 | 1:20–1:55 | Embedding＋向量搜尋找附近口味相近的人、推播、退點數 | 技術、影響 |
| E 備料與預測 | 1:55–2:25 | 截單後備料／叫貨單；BigQuery AI 7 天預測與客群 | 技術、創新（25%） |
| F 取餐與愛心餐 | 2:25–2:40 | 相機掃簽章 QR；沒取的餐變愛心餐 | 影響 |
| G 數據與架構 | 2:40–3:00 | Looker Studio（救回份數、預測 vs. 實際）、架構圖、結尾頁 | 技術：可擴展性；影響 |

**原則**
- B～F 全部是**正式站實機操作**，不是投影片——評審要看「能跑的原型」。
- 每個 AI 功能出現時，畫面下方加字卡寫出用到的 Google 技術。評審看字卡就知道整合深度。
- 每段都講「AI 在背後做了什麼決策」，不要只講「點這裡、點那裡」。

---

## 2. 分鏡與字卡

旁白全文見 `Submission_EN.md` 第 2 節，這裡只寫畫面操作與字卡。

| 段落 | 畫面操作 | 字卡 |
|---|---|---|
| A | 封面投影片 → 正式站首頁，捲過早鳥價格日期列 | `Theme: Retail & Commerce — Intelligent Customer and Business Experiences` |
| B | 店家後台 → 菜單 →「拍照上架」→ 拍紙本菜單 → 草稿出現 → 改一個過敏原 → 確認上架 | `Gemini multimodal on Vertex AI → structured JSON · extractMenuFromImage` |
| C | 消費者首頁 → 預購助理 → 輸入 “Lunch next Monday to Friday, Da'an, under 120, no beef” → 候選卡片 → 點一張 → 看早鳥價 → LINE Pay Sandbox 結帳（等待畫面剪掉） | `Gemini function calling · server-side tools · askShoppingAssistant` |
| D | 我的餐點 → 轉讓 → 上架。切到第二支手機：推播跳出 → 點開 → 付款接手 → 回第一支手機看到點數退款 | `gemini-embedding-001 · Firestore Vector Search · Firebase Cloud Messaging` |
| E | 店家後台 → 今日備料（鎖定份數、備料清單）→ 報表 → 營收：「未來 7 天」預估卡與「常客是誰」 | `BigQuery AI.FORECAST · ML.KMEANS · AI.GENERATE` |
| F | 消費者出示 QR → 取餐掃碼頁用相機掃 → 已取餐 → 帶過愛心餐分頁 | `Signed QR · Cloud Scheduler cut-off (20:00)` |
| G | 管理後台 → 平台儀表板（Looker Studio：救回份數、預測 vs. 實際）→ 架構投影片 → 結尾頁（網址） | `Gemini on Vertex AI · Cloud Run · Firestore · BigQuery AI · Looker Studio · Gen AI Evaluation` |

---

## 3. 錄影前準備

Google Cloud 補強（Vertex AI、BigQuery 同步、`AI.FORECAST`、`ML.KMEANS`＋`AI.GENERATE`）已在 10/10 部署；還沒完成的項目以 [TODO.md](TODO.md) 為準（Looker Studio 報表、正式站示範商家帳號、補翻既有資料）。

- [ ] Looker Studio 報表已建好並嵌入管理後台「平台儀表板」（G 段要用）
- [ ] 正式站示範商家帳號可登入（B、E、F 段要用）
- [ ] 已跑過管理後台「補翻既有資料」，英文介面的店名、菜名是英文
- [ ] 正式站已部署最新 Functions、rules、indexes，並跑過一次 `backfillMenuEmbeddings`（D 段推播才會出現）
- [ ] 帳號：店家 1、消費者 A（下單、轉讓）、消費者 B（接手；過去訂過類似菜色、常用地點在 10 公里內、今天還沒收過 2 則媒合通知）
- [ ] 一張手寫或印好的紙本菜單（B）
- [ ] 消費者 A 先訂好兩天後的一份餐（D 用），店家今天有幾筆訂單（E 備料頁才有數字）
- [ ] 介面切成英文；瀏覽器縮放到字看得清楚；關掉不相干的分頁與通知
- [ ] 先把各段彩排一次，確認 Gemini 回應速度；Vertex AI 遇到 429（配額）就等一下再錄

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
