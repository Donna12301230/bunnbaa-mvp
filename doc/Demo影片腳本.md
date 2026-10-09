# BunnBaa Demo 影片腳本與錄製指南（3 分鐘）

對應官方說明會的五個重點：可運作的原型、語音導覽、公開存取、呼應評分標準、結構化呈現。
旁白一律英文（提交物必須英文），本文件的說明用中文給團隊看。英文旁白同步放在 `Submission_EN.md` 第 2 節。

---

## 1. 影片結構與評分對照

| 段落 | 時間 | 內容 | 對應評分 |
|---|---|---|---|
| A 問題陳述 | 0:00–0:20 | 小餐館先備料後接單、剩食與撲空 | 問題對齊（25%） |
| B 解決方案與賽題 | 0:20–0:35 | 預付鎖定、越早越便宜；點名 Retail & Commerce 賽題 | 問題對齊、創新 |
| C 實機操作：四個 Gemini 功能 | 0:35–2:15 | 拍照上架 → 預購助理 → 轉讓媒合 → 備料預測 | **技術（40%）**、使用者體驗（10%） |
| D 架構與負責任 AI | 2:15–2:35 | 全 Google Cloud 架構圖；AI 只建議、金額由程式算 | 技術（40%）、創新（25%） |
| E 擴展性與影響 | 2:35–3:00 | 上架成本趨近零、BigQuery／Vertex AI 路線、救回份數可量化 | 技術：可擴展性；影響 |

**原則**
- C 段佔一半以上時間，而且全部是**正式站實機操作**，不是投影片——評審要看「能跑的原型」。
- 每個 AI 功能出現時，畫面下方加字卡寫出用到的 Google 技術，例如「Gemini multimodal · Cloud Functions `extractMenuFromImage`」。評審看字卡就知道整合深度。
- 每段都講「AI 在背後做了什麼決策」，不要只講「點這裡、點那裡」。

---

## 2. 分鏡與英文旁白

語速約每秒 2.3 個英文字；每段旁白字數已照時間控制。括號裡是畫面上的字卡。

### A　問題陳述（0:00–0:20）

畫面：封面投影片 → 餐館排隊或備料的照片／投影片第 2 頁。

> Every day, small eateries near campuses and offices buy ingredients before a single order comes in. Guess too high and food goes in the bin. Guess too low and hungry customers walk away. And when a customer who paid can't show up, that meal is wasted too.

字卡：`Theme: Retail & Commerce — Intelligent Customer and Business Experiences`

### B　解決方案（0:20–0:35）

畫面：正式站首頁，捲過早鳥價格日期列。

> BunnBaa turns guesswork into confirmed demand. Diners pay ahead to lock a meal — the earlier they book, the bigger the discount — so vendors know exactly what to cook. Gemini runs through every step.

### C1　拍照上架（0:35–1:00）

畫面：店家後台 → 菜單 →「拍照上架」→ 拍紙本菜單 → 草稿出現 → 改一個過敏原 → 確認上架。

> For a small shop, onboarding takes one photo. Gemini's multimodal model reads a paper menu and drafts every item: name, English name, price, dietary tags and allergens. Nothing goes live until the owner checks and confirms.

字卡：`Gemini multimodal → structured JSON · Cloud Functions: extractMenuFromImage`

### C2　對話式預購助理（1:00–1:30）

畫面：消費者首頁 → 預購助理 → 輸入 “Lunch next Monday to Friday, Da'an, under 120, no beef” → 候選卡片 → 點一張 → 看早鳥價 → LINE Pay Sandbox 結帳（等待畫面剪掉）。

> Diners don't browse ten shops — they just ask. Gemini uses function calling to search menus, check availability and find multi-day plans, all on our server. It returns meals that can actually be booked, with allergies filtered out. It suggests; it never buys. Booking two days ahead saves twenty percent.

字卡：`Gemini function calling · 4 server-side tools · Cloud Functions: askShoppingAssistant`

### C3　轉讓智慧媒合（1:30–1:55）

畫面：我的餐點 → 轉讓 → 選轉讓價 → 上架。切到第二支手機：推播跳出 → 點開 → 付款接手 → 回第一支手機看到點數退款。

> Plans change. Instead of wasting the meal, the diner lists it for resale. We embed every dish with Gemini, search Firestore's vector index for people nearby who like similar food, and push them an alert. Someone takes it over, and the first diner is refunded. One more meal rescued — and we count every one.

字卡：`gemini-embedding-001 · Firestore Vector Search (KNN) · Firebase Cloud Messaging`

### C4　備料預測與取餐（1:55–2:15）

畫面：店家後台 → 今日備料：鎖定份數、「預估實際取餐」區間、備料清單 → 問一個 what-if → 取餐掃碼頁用相機掃 QR → 已取餐。

> After the evening cut-off, the vendor has an exact count and a ready-made prep list. The pickup range comes from statistics, and Gemini explains it and answers what-if questions. At the counter, a signed QR code completes pickup.

字卡：`Statistics compute the numbers · Gemini explains · Cloud Scheduler cut-off`

### D　架構與負責任 AI（2:15–2:35）

畫面：投影片「Architecture」→「Responsible AI」。

> Everything runs on Google Cloud: Firebase Hosting, seventy-four Cloud Functions on Cloud Run, Firestore with vector search, and Gemini for vision, tools and embeddings. Our rule: AI advises, code calculates, people decide. Gemini never touches prices or quantities.

### E　擴展性與影響（2:35–3:00）

畫面：投影片「Impact」→「Scalability」→ 結尾頁（網址）。

> A new vendor is one photo away, translation is automatic, and the stack is serverless, so BunnBaa can grow from one campus to every lunch district. Next, we stream Firestore to BigQuery for forecasting at scale. Cook what's ordered. Eat what's cooked.

> 如果 Vertex AI 遷移（`doc/GoogleCloud改動建議.md` 的 P0）在錄影前完成，D 段改成 “…and Gemini on Vertex AI for vision, tools and embeddings.”；E 段的 BigQuery 若已上線，改成 “Our data already streams to BigQuery…” 並秀一張 BigQuery 畫面。**沒做完就不要講成已完成。**

---

## 3. 錄影前準備

- [ ] 正式站已部署最新 Functions、rules、indexes，並跑過一次 `backfillMenuEmbeddings`（C3 推播才會出現）
- [ ] 帳號：店家 1、消費者 A（下單、轉讓）、消費者 B（接手；過去訂過類似菜色、常用地點在 10 公里內、今天還沒收過 2 則媒合通知）
- [ ] 一張手寫或印好的紙本菜單（C1）
- [ ] 消費者 A 先訂好兩天後的一份餐（C3 用），店家今天有幾筆訂單（C4 備料頁才有數字）
- [ ] 介面切成英文；瀏覽器縮放到字看得清楚；關掉不相干的分頁與通知
- [ ] 先把四段各彩排一次，確認 Gemini 回應速度；免費層遇到 429 就換有額度的 key 或等一下再錄

## 4. 錄製與剪輯

- 1080p 錄螢幕；手機畫面用鏡像投到電腦錄，或用手機內建錄影再剪進來
- 旁白另外錄（安靜環境、耳機麥克風），剪輯時對齊畫面；**一定要有語音**
- 剪掉所有等待時間：LINE Pay 跳轉、Gemini 生成中、推播延遲
- 加英文字幕與第 2 節的技術字卡
- 總長控制在 3:00 以內

## 5. 上傳與公開設定

- YouTube：可見度選「公開」或「不公開（知道連結的人可看）」；**不要選「私人」**
- Google 雲端硬盤：共用設定改成「知道連結的任何人 → 檢視者」
- 上傳後用**無痕視窗、未登入**開一次連結，確認看得到
- 連結填進 `Submission_EN.md`、投影片結尾頁與提交表單

## 6. 交件前自我檢查

- [ ] 前 20 秒內講清楚問題，並點名賽題（Retail & Commerce）
- [ ] 四個 Gemini 功能都是正式站實機操作，各有技術字卡
- [ ] 有講到「AI 在背後做了什麼」與「AI 不碰金額」
- [ ] 有架構畫面，看得出全部在 Google Cloud
- [ ] 有一句擴展性、一句可量化的影響
- [ ] 全程英文語音＋字幕，長度 ≤ 3:00
- [ ] 無痕視窗打得開
