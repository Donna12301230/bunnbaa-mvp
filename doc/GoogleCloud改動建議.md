# Google Cloud 技術補強建議（Google AI Builder Cup 2026）

賽題：零售與商業 — 智慧客戶與商業體驗。截止 **10/18**（今天 10/09，剩 9 天）。

賽題建議的技術：Gemini on Vertex AI、Vertex AI Search、BigQuery、BigQuery AI、Cloud Run、Cloud Storage、AlloyDB／Cloud SQL、Looker。

## 摘要

- **先做 P0**：Gemini 改走 Vertex AI、Firestore 同步到 BigQuery。這兩項最快補上「Google Cloud 技術深度」的分數。
- **再做 P1**：BigQuery AI 需求預測、購物籃與分群、Looker Studio 儀表板，用來呈現「減少浪費」的成效。
- **P2 選做**：Vertex AI Search、預購助理讀取預測、AI 回答品質評估。時間不夠就放進簡報的「下一步（Roadmap）」。

| 優先 | 項目 | 工時 |
|---|---|---|
| P0 | Gemini 改走 Vertex AI | 0.5 天 |
| P0 | Firestore → BigQuery 同步 | 0.5 天 |
| P1 | BigQuery AI：需求預測 | 1 天 |
| P1 | BigQuery AI：購物籃與客戶分群 | 0.5 天 |
| P1 | Looker Studio 儀表板 | 0.5 天 |
| P2 | Vertex AI Search | 1 天以上 |
| P2 | 預購助理讀取預測 | 0.5 天 |
| P2 | 預購助理回答品質評估 | 0.5 天 |

## 現況

BunnBaa 的 AI 功能已經涵蓋大部分賽題方向，弱點在「Google Cloud 技術用得少」：

| 賽題方向 | 已有功能 | 用到的技術 |
|---|---|---|
| 對話式商務 | `shoppingAssistant.js` 預購助理（function calling） | Gemini API（API key） |
| 個人化 | `insights.js` 口味檔案、過敏原伺服器端過濾 | Firestore |
| 產品發現 | `resaleMatch.js` 轉讓媒合（768 維向量 KNN） | Gemini embedding + Firestore 向量索引 |
| 需求預測／庫存 | `vendorCalibration.js` 鎖定量 vs. 實際取餐 | Gemini API |
| 客戶洞察 | `areaInsights` 區域口味、許願缺口 | Firestore |
| 商品素材 | `menuVision.js` 拍照上架 | Gemini Vision |

問題：

- `functions/src/gemini.js` 用 `@google/generative-ai` + `GEMINI_API_KEY`，走的是 AI Studio，**不是 Vertex AI**。
- 沒有分析資料倉儲，「需求預測」「購物籃分析」只靠 Firestore 即時統計，評審看不到 BigQuery / Looker。

## P0：必做

> **進度（10/10）**：P0 與 P1 需求預測都已部署到正式環境。

### Gemini 改走 Vertex AI（約 0.5 天）

只改 `functions/src/gemini.js` 一個檔，其他模組都透過它呼叫，不用動。

- 套件：`@google/generative-ai` → `@google/genai`（新版統一 SDK，支援 Vertex 模式）。
- 初始化改成：
  ```js
  const { GoogleGenAI } = require("@google/genai");
  const ai = new GoogleGenAI({
    vertexai: true,
    project: process.env.GCLOUD_PROJECT,   // Functions 執行環境自帶
    location: "asia-east1",                 // 確認模型在此區可用，不行就用 "global"
  });
  ```
- 呼叫改成 `ai.models.generateContent({ model, contents, config: { systemInstruction, temperature, responseMimeType, tools } })`；embedding 改 `ai.models.embedContent({ model, contents, config: { outputDimensionality: 768, taskType } })`。
- `runWithTools` 的 function calling 迴圈要跟著新 SDK 的回傳格式調整（`response.functionCalls`）。
- 權限：Functions 預設服務帳號加上 `roles/aiplatform.user`；在 GCP 啟用 Vertex AI API。
- 移除 `GEMINI_API_KEY`（`.env.example`、`.env.local`、`doc/開發指南.md` 都要更新）。
- 好處：服務帳號認證、不怕 API key 外洩、沒有免費層 429（`withRetry` 留著當保險）。
- **驗證**：emulator 跑一次預購助理、拍照上架、轉讓媒合；embedding 維度必須仍是 768，否則 `firestore.indexes.json` 的向量索引會失效、`menu_embeddings` 要重算。
- **已完成**：`gemini.js` 改用 `@google/genai`（Vertex 模式），預設 `global` 端點（`VERTEX_LOCATION` 可覆蓋）；本機 emulator 用 `GEMINI_DISABLED=1` 取代原本「把 key 設空白」。已用假 fetch 確認請求打到 `aiplatform.googleapis.com`、function calling 迴圈與 768 維 embedding 格式正確。
- **已部署**：Vertex AI API 已啟用、服務帳號已加 `roles/aiplatform.user`，`gemini-3.6-flash`（global）與 768 維 embedding 實測可用，全部 functions 已重新部署。待辦：在正式站實際問一次預購助理；`functions/.env` 裡的 `GEMINI_API_KEY` 可刪除。

### Firestore → BigQuery 同步（約 0.5 天）

用官方 Firebase Extension **Stream Firestore to BigQuery**（`firebase/firestore-bigquery-export`），不用寫程式。

- 每個 collection 裝一個實例：`locks`、`menu_items`、`vendors`、`payment_intents`（`payment_intents` 只同步金額、狀態、時間，不同步付款識別資料）。
- Dataset：`bunnbaa_analytics`，location `asia-east1`。
- 既有資料用 extension 附的 `fs-bq-import-collection` 腳本一次回填。
- 用 extension 的 `fs-bq-schema-views` 產生有型別的 view（`locks_schema_locks_latest`，命名規則是 `{表}_schema_{schema 檔名}_latest`），後面的 SQL 都查 view。
- 個資：`buyer_uid` 保留（分群需要）；手機、備註、交易序號、取餐碼等由 transform function `bqTransform`（`functions/src/bigqueryExport.js`）在寫入前拿掉，原始 changelog 裡也沒有。
- **已完成**：`firebase.json` 的 `extensions` 與 `extensions/bq-*.env`（`firebase deploy --only extensions --dry-run` 已通過）、`bigquery/schemas/*.json`。
- **已部署**：`bqTransform`、四個 extension、回填（locks 3,659 筆等，已查核無個資欄位）、schema view。

## P1：建議做

### BigQuery AI：需求預測（約 1 天）

用鎖定紀錄預測「每家店、每天」的份數，直接對上賽題「需求預測／庫存智慧」。

```sql
-- 每店每日鎖定量
CREATE OR REPLACE VIEW bunnbaa_analytics.daily_demand AS
SELECT vendor_id, DATE(pickup_date) AS day, COUNT(*) AS locks
FROM bunnbaa_analytics.locks_schema_locks_latest
-- 每筆鎖定都是一份需求（轉讓、愛心餐也算），不用過濾 status
GROUP BY vendor_id, day;

-- 未來 7 天預測（TimesFM，免訓練）
SELECT *
FROM AI.FORECAST(
  TABLE bunnbaa_analytics.daily_demand,
  data_col => 'locks',
  timestamp_col => 'day',
  id_cols => ['vendor_id'],
  horizon => 7);
```

- 種子資料歷史不夠長，預測會很平。改成在 BigQuery 直接產生 90 天模擬背景需求（`demand_history_sim`，星期效應、雨天、成長、雜訊），疊加在真實份數上；不寫進正式 Firestore，不會觸發觸發器與 Gemini。
- **已完成（10/10）**：`bigquery/sql/01_demand_forecast.sql`（模擬資料、`daily_demand`、`demand_forecast`、`forecast_vs_actual`、14 天回測）、`functions/src/demandForecast.js`（每天 05:00 跑 `AI.FORECAST` 寫回 `vendors/{v}/forecast/{日期}`）、商家後台營收頁的「未來 7 天預估份數」卡片。取消的鎖定不算需求（不用備料）。
- **已部署**：SQL 已執行（回測 14 天，平均誤差 11%）；`demandForecast` 以服務帳號在正式環境跑過，`vendors/{v}/forecast` 已寫入 7 天預測。
- 呈現：排程函式每天把預測結果寫回 Firestore `vendors/{v}/forecast`，商家後台報表頁顯示「預估明天 N 份（參考）」。沿用 `vendorCalibration` 的原則：**只給參考，不下備料指令**。

### BigQuery AI：購物籃與客戶分群（約 0.5 天）

- 購物籃：同一個 `buyer_uid` 同一天、同一家店一起鎖的品項配對次數（純 SQL self-join），找出「常一起買」。可餵給預購助理當推薦依據。
- 分群：`ML.KMEANS` 用每位會員的 RFM（最近一次鎖定、頻率、金額）＋轉讓率＋爽約率分 4～5 群。
- 用 `AI.GENERATE` 讓 Gemini 對每一群產生一句中文描述（例如「平日午餐固定客、對價格敏感」），商家看得懂。
- **已部署（10/10）**：`functions/src/customerInsights.sql`＋`customerInsights.js`（每週一 04:00，管理員可用 `triggerCustomerInsightsNow` 重跑），結果寫回 `vendors/{v}/analytics/basket`、`segments`，商家後台營收頁新增「你的熟客是哪些人／常一起買」卡片。
  - 購物籃改成「同一位客人在同一家店都買過」：一筆訂單幾乎只有一個品項，同一天的配對只有 1 組。
  - 分群只納入過去 90 天買過 2 份以上的會員（約 100 人）；2,544 個 `demo-user-*` 一次性帳號不納入。
  - `AI.GENERATE` 偶爾會重複輸出到被截斷，SQL 最後會對欄位不完整的群組重試一次。
  - K-means 每週重新訓練，群組編號與名稱每週可能不同（同一次產生的群名與人數一致）。

### Looker Studio 儀表板（約 0.5 天）

- 連 `bunnbaa_analytics`，做一頁平台儀表板：每日鎖定量、預測 vs. 實際、轉讓救回份數（`resale_matches.claimed_by_match`）、愛心餐份數、客群分布。
- 「預測 vs. 實際」和「救回份數」是展示影片的核心畫面，直接講減少浪費的成效，也是評審判斷專案是否「落地」的關鍵。
- 嵌入管理後台（`web/src/pages/admin/`）一個 iframe 頁即可，不必做進商家後台。

## P2：選做（時間不夠就放 Roadmap）

### Vertex AI Search（約 1 天以上）

用來做品項的語意搜尋（「清淡、有湯、不要牛」）。現有 Firestore KNN 已能用，時間不夠就**不做**，在簡報提「下一步」即可。

### 預購助理讀取預測（約 0.5 天）

`shoppingAssistant.js` 已經是 function calling 架構，不需要另外導入 ADK（Agent Development Kit）。只要多加一個工具，讓助理讀 `vendors/{v}/forecast` 與購物籃結果，就能展示「AI 依預測調整推薦」（例如推薦預估還有餘量的店家、常一起買的品項）。簡報上以「代理式工作流程（Agentic Workflow）」說明即可。

### 預購助理回答品質評估（約 0.5 天）

- 準備 20～30 題測試問句（含過敏原、預算、時段等限制），用 **Vertex AI Gen AI Evaluation Service** 評分回答是否正確、是否違反過敏原限制。
- 主要用途是簡報上證明系統穩定，結果截圖放進投稿文件。

## 不需要改，簡報上講清楚就好

- **Cloud Run**：Functions 第二代底層就是 Cloud Run。
- **Cloud Storage**：Firebase Storage 就是 Cloud Storage（菜單照片、商品圖）。
- **AlloyDB／Cloud SQL**：營運資料用 Firestore 已足夠，不建議為了比賽遷移。

## 時程建議

| 日期 | 工作 |
|---|---|
| 10/09–10/10 | P0：Vertex AI 遷移 + BigQuery 同步、回填 |
| 10/11 | 補 90 天模擬資料、需求預測 SQL、寫回 Firestore |
| 10/12 | 購物籃、分群、`AI.GENERATE` 描述 |
| 10/13 | Looker Studio 儀表板、嵌入後台 |
| 10/14 | 部署正式站、全流程測試（有餘裕再做 P2） |
| 10/15–10/17 | 更新 `Submission_EN.md`、簡報架構圖、錄展示影片 |

## 投稿文件要跟著更新

- `doc/Submission_EN.md` 的技術清單與架構說明：加上 Vertex AI、BigQuery、BigQuery AI（`AI.FORECAST`、`ML.KMEANS`、`AI.GENERATE`）、Looker Studio。
- 簡報架構圖：Firestore →（Extension）→ BigQuery → Looker／預測寫回 Firestore → 商家後台。
- `doc/開發指南.md` 的環境變數段落：拿掉 `GEMINI_API_KEY`，改寫 Vertex 權限設定。

## 風險

- **模型區域**：確認 `gemini-3.6-flash` 與 `gemini-embedding-001` 在 Vertex 的 `asia-east1` 可用；不可用就改 `global` 端點（資料落地位置要寫進 ISMS 文件）。
- **費用**：Blaze 方案下 Vertex 按量計費，預購助理已有每日次數上限，影響不大；BigQuery 查詢量很小，幾乎在免費額度內。
- **個資**：BigQuery 只放分析需要的欄位，dataset 權限只給管理員；要同步更新 `doc/ISMS_管理制度文件.md` 的資料流描述。
